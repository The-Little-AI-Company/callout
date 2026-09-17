/**
 * Deep lane (PLAN section 4, PRD F9 to F14g).
 *
 * Pipeline, all owned by code:
 *   1. extract claims (helper) -> substring prefilter -> Jev: checkable, central
 *   2. gather evidence: cited sources first, then Tavily with helper-written queries
 *   3. rerank passages with Jev (one call per claim)
 *   4. judge support with Jev (one call per claim), roll up in code
 *   5. explain with the helper from kept passages only
 *   6. check every explanation sentence with Jev; drop failures; regenerate once
 *
 * Never a verdict without a shown source. Never an invented source.
 */
import type { Questions } from "@typesafe-ai/sdk";
import type { JevJudge } from "../jev/client";
import type { QuestionContent, EntryType } from "../content";
import type { LlmHelper } from "../helper/llm";
import type { HelperPrompts } from "../helper/tasks";
import { extractClaims, writeQueries, explain as helperExplain } from "../helper/tasks";
import type { PageFetcher } from "../fetch/readable";
import type { SearchClient } from "./search";
import { splitPassages, splitSentences, containsQuote, extractUrls } from "../text/sentences";
import type { ClaimVerdict, DeepLaneEvent, DeepLaneResult, ExtractedClaim, Explanation, FetchedPage, Passage, PassageJudgment, Verdict, ConfidenceBand } from "../types";

export interface DeepLaneDeps {
  jev: JevJudge;
  content: QuestionContent;
  /** Absent when the helper is off. The deep lane then needs cited URLs in the text to do anything. */
  llm?: LlmHelper;
  prompts: HelperPrompts;
  fetcher: PageFetcher;
  /** Absent when no Tavily key is configured. */
  search?: SearchClient;
  online: boolean;
}

export interface DeepLaneInput {
  text: string;
  /** Page URL when the capture was a page; cited by every claim by default. */
  pageUrl?: string;
  /** Claims already extracted (e.g. from a follow-up). Skips the helper step. */
  claims?: ExtractedClaim[];
  signal?: AbortSignal;
}

type Emit = (e: DeepLaneEvent) => void;

export async function runDeepLane(deps: DeepLaneDeps, input: DeepLaneInput, emit: Emit): Promise<DeepLaneResult> {
  const t0 = Date.now();
  const th = deps.content.thresholds;
  const V = deps.content.verdicts;
  const pagesFetched: FetchedPage[] = [];
  let firstVerdictMs: number | undefined;

  const fail = (message: string): DeepLaneResult => {
    emit({ type: "error", message });
    return { claims: [], counts: emptyCounts(), pagesFetched, timing: { totalMs: Date.now() - t0 } };
  };

  // 1. Claims.
  let claims: ExtractedClaim[];
  if (input.claims?.length) {
    claims = input.claims;
  } else if (deps.llm) {
    emit({ type: "status", message: "extracting" });
    try {
      claims = (await extractClaims(deps.llm, deps.prompts, input.text, th.max_claims, input.signal)).kept;
    } catch (e) {
      return fail(`Claim extraction failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    // Without the helper, each sentence that contains a URL or a number is a candidate claim.
    claims = fallbackClaims(input.text, th.max_claims);
  }
  if (claims.length === 0) {
    const result: DeepLaneResult = { claims: [], counts: emptyCounts(), pagesFetched, timing: { totalMs: Date.now() - t0 } };
    emit({ type: "done", result });
    return result;
  }

  // Jev: checkable and central, one call for all claims (speculative fan-out).
  const gateQ: Questions = {};
  for (const c of claims) {
    gateQ[`checkable:${c.id}`] = { type: "noul", instructions: withClaim(deps.content.deep_lane.claim_checkable.instructions, c.id), criteria: deps.content.deep_lane.claim_checkable.criteria as never };
    gateQ[`central:${c.id}`] = { type: "noul", instructions: withClaim(deps.content.deep_lane.claim_central.instructions, c.id), criteria: deps.content.deep_lane.claim_central.criteria as never };
    gateQ[`faithful:${c.id}`] = { type: "noul", instructions: withClaim(deps.content.deep_lane.claim_quote_faithful.instructions, c.id), criteria: deps.content.deep_lane.claim_quote_faithful.criteria as never };
  }
  const gateState = { text: input.text, claims: Object.fromEntries(claims.map((c) => [c.id, { text: c.text, quote: c.quote }])) };
  let gate: Record<string, { noul?: number }>;
  try {
    gate = (await deps.jev.ask(gateState, gateQ, { lane: "deep", step: "claim_gate", signal: input.signal })).answers as never;
  } catch (e) {
    return fail(`Jev claim check failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const rows: ClaimVerdict[] = claims.map((c) => {
    const checkable = gate[`checkable:${c.id}`]?.noul ?? 0;
    const central = gate[`central:${c.id}`]?.noul ?? 0;
    const faithful = gate[`faithful:${c.id}`]?.noul ?? 1;
    const base = { claim: c, checkable, central, judgments: [], thresholds: { support_confidence: th.support_confidence } };
    if (checkable < th.checkable_min || faithful < 0.5) {
      return { ...base, verdict: "not_checkable", verdictLabel: V.not_checkable.label, why: V.not_checkable.why, band: "none", bandLabel: V.confidence_bands.none };
    }
    if (central < th.central_min) {
      return { ...base, verdict: "incidental", verdictLabel: V.incidental.label, why: V.incidental.why, band: "none", bandLabel: V.confidence_bands.none };
    }
    return { ...base, verdict: "unsure", verdictLabel: V.unsure.label, why: "", band: "none", bandLabel: V.confidence_bands.none };
  });
  emit({ type: "claims", claims: rows });

  const toCheck = rows.filter((r) => r.verdict === "unsure");
  if (!deps.online) {
    for (const r of toCheck) setUnsure(r, V, "offline");
    for (const r of toCheck) emit({ type: "claim", claim: r });
    return finish(rows, pagesFetched, t0, firstVerdictMs, emit);
  }

  // 2 to 4, per claim, concurrently with a small cap.
  const textUrls = extractUrls(input.text);
  await mapLimit(toCheck, 3, async (row) => {
    if (input.signal?.aborted) return;
    try {
      await checkClaim(deps, input, row, textUrls, pagesFetched);
    } catch (e) {
      setUnsure(row, V, "fetch_failed");
      row.why = `${row.why} (${e instanceof Error ? e.message : String(e)})`;
    }
    if (firstVerdictMs === undefined && (row.verdict === "supported" || row.verdict === "contradicted")) firstVerdictMs = Date.now() - t0;
    emit({ type: "claim", claim: row });
  });

  // 5 and 6: explanation, only with the helper and only when something was judged.
  let explanation: Explanation | undefined;
  const judged = rows.filter((r) => r.judgments.length > 0);
  if (deps.llm && judged.length > 0 && !input.signal?.aborted) {
    emit({ type: "status", message: "explaining" });
    try {
      explanation = await explainAndCheck(deps, rows, input.signal);
      emit({ type: "explanation", explanation });
    } catch {
      // The explanation is optional. Verdicts stand on their own.
    }
  }

  return finish(rows, pagesFetched, t0, firstVerdictMs, emit, explanation);
}

async function checkClaim(deps: DeepLaneDeps, input: DeepLaneInput, row: ClaimVerdict, textUrls: string[], pagesFetched: FetchedPage[]): Promise<void> {
  const th = deps.content.thresholds;
  const V = deps.content.verdicts;
  const claim = row.claim;

  // 2a. Cited sources first (PRD F11).
  const citedUrls = uniq([claim.citedUrl, ...(input.pageUrl ? [input.pageUrl] : []), ...textUrls].filter((u): u is string => !!u));
  const pages: FetchedPage[] = [];
  const fallbackSnippets: Passage[] = [];
  for (const url of citedUrls.slice(0, th.max_pages_per_claim)) {
    const page = await deps.fetcher.fetchPage(url);
    pushPage(pagesFetched, page);
    pages.push(page);
  }

  // Fabricated quote check (PRD F20): the text quotes a source, and the quote is not in it.
  if (claim.attributedQuote && claim.citedUrl) {
    const cited = pages.find((p) => p.url === claim.citedUrl);
    if (cited?.status === "ok" && !containsQuote(cited.text, claim.attributedQuote)) {
      row.verdict = "fabricated_quote";
      row.verdictLabel = V.fabricated_quote.label;
      row.why = V.fabricated_quote.why;
      row.band = "strong";
      row.bandLabel = V.confidence_bands.strong;
      row.best = { passage: { id: "src", url: cited.url, title: cited.title, text: cited.text.slice(0, 600), index: 0 }, relevance: 3, relation: "contradicts", probabilities: {}, confidence: 1 };
      return;
    }
  }

  // 2b. Web search.
  const okPages = pages.filter((p) => p.status === "ok");
  if (okPages.length < th.max_pages_per_claim && deps.search) {
    let queries: string[] = [];
    if (deps.llm) {
      try {
        queries = await writeQueries(deps.llm, deps.prompts, claim.text, input.text, th.max_queries_per_claim, input.signal);
      } catch {
        queries = [];
      }
    }
    if (queries.length === 0) queries = [claim.text.slice(0, 200)];
    const seen = new Set(pages.map((p) => p.url));
    const candidates: Array<{ url: string; title: string; content: string }> = [];
    for (const q of queries) {
      try {
        for (const r of await deps.search.search(q, { maxResults: th.max_search_results_per_query, signal: input.signal })) {
          if (!seen.has(r.url) && !candidates.some((c) => c.url === r.url)) candidates.push(r);
        }
      } catch {
        // A failed query is not fatal; other queries or cited pages may still work.
      }
    }
    for (const c of candidates) {
      if (okPages.length >= th.max_pages_per_claim) break;
      const page = await deps.fetcher.fetchPage(c.url);
      pushPage(pagesFetched, page);
      pages.push(page);
      if (page.status === "ok") okPages.push(page);
      else if (c.content?.length > 80) {
        // Page blocked; Tavily's snippet is still real text from that URL, labeled as such.
        fallbackSnippets.push({ id: `${c.url}#snippet`, url: c.url, title: c.title, text: c.content, index: 0 });
      }
    }
  } else if (okPages.length === 0 && !deps.search && citedUrls.length === 0) {
    setUnsure(row, V, "no_search_key");
    return;
  }

  // 3. Passages and rerank.
  const passages: Passage[] = [...fallbackSnippets];
  for (const p of okPages) {
    splitPassages(p.text, { maxPassages: th.max_passages_per_page }).forEach((t, i) => passages.push({ id: `${p.url}#${i}`, url: p.finalUrl ?? p.url, title: p.title, text: t, index: i }));
  }
  if (passages.length === 0) {
    const reason = pages.some((p) => p.status === "paywalled") ? "paywalled" : pages.some((p) => p.status === "failed" || p.status === "empty") ? "fetch_failed" : "no_source_found";
    setUnsure(row, V, reason);
    return;
  }

  const relQ: Questions = {};
  passages.forEach((_, i) => {
    relQ[`p${i}`] = { type: "score", instructions: { ...(deps.content.deep_lane.passage_relevance.instructions as object), passage: `passages[${i}]` }, criteria: deps.content.deep_lane.passage_relevance.criteria as never };
  });
  const relRes = await deps.jev.ask({ claim: claim.text, passages: passages.map((p) => p.text) }, relQ, { lane: "deep", step: "rerank", signal: input.signal });
  const scored = passages
    .map((p, i) => ({ p, score: (relRes.answers as Record<string, { score?: number }>)[`p${i}`]?.score ?? 0 }))
    .filter((x) => x.score >= th.relevance_min_score)
    .sort((a, b) => b.score - a.score)
    .slice(0, th.relevance_keep_top);
  if (scored.length === 0) {
    setUnsure(row, V, "off_topic");
    return;
  }

  // 4. Support judgment, one Choice per kept passage in one call.
  const supQ: Questions = {};
  scored.forEach((_, i) => {
    supQ[`s${i}`] = { type: "choice", instructions: { ...(deps.content.deep_lane.relation.instructions as object), passage: `passages[${i}]` }, criteria: deps.content.deep_lane.relation.criteria as never };
  });
  const supRes = await deps.jev.ask({ claim: claim.text, passages: scored.map((x) => x.p.text) }, supQ, { lane: "deep", step: "support", signal: input.signal });
  row.judgments = scored.map((x, i) => {
    const a = (supRes.answers as Record<string, { choice: "supports" | "contradicts" | "says_nothing"; probabilities: Record<string, number>; confidence: number }>)[`s${i}`]!;
    return { passage: x.p, relevance: x.score, relation: a.choice, probabilities: a.probabilities, confidence: a.confidence };
  });
  rollUp(row, deps.content);
}

/** Roll-up in code (PLAN 4.4). Any high-confidence contradiction wins; otherwise strongest support; otherwise unsupported. */
export function rollUp(row: ClaimVerdict, content: QuestionContent): void {
  const th = content.thresholds;
  const V = content.verdicts;
  const js = row.judgments;
  const contra = js.filter((j) => j.relation === "contradicts").sort((a, b) => b.confidence - a.confidence);
  const supp = js.filter((j) => j.relation === "supports").sort((a, b) => b.confidence - a.confidence);
  const strongContra = contra.filter((j) => j.confidence >= th.support_confidence);
  const strongSupp = supp.filter((j) => j.confidence >= th.support_confidence);

  const set = (verdict: Verdict, best: PassageJudgment | undefined, band: ConfidenceBand, why: string, reason?: string) => {
    row.verdict = verdict;
    row.verdictLabel = (V as unknown as Record<string, { label: string }>)[verdict]!.label;
    row.best = best;
    row.band = band;
    row.bandLabel = V.confidence_bands[band];
    row.why = why;
    row.unsureReason = reason;
  };

  if (strongContra.length > 0) {
    set("contradicted", strongContra[0], strongContra.length > 1 ? "strong" : "some", V.contradicted.why);
  } else if (strongSupp.length > 0 && contra.length === 0) {
    set("supported", strongSupp[0], strongSupp.length > 1 ? "strong" : "some", V.supported.why);
  } else if (supp.length > 0 && contra.length > 0) {
    set("mixed", supp[0], "some", V.mixed.why);
  } else if (supp.length > 0 || contra.length > 0) {
    // Evidence leans one way but under the confidence threshold: unsure, with the passage shown.
    set("unsure", (supp[0] ?? contra[0])!, "none", V.unsure_reasons.low_confidence!, "low_confidence");
  } else {
    set("unsupported", js[0], "none", V.unsupported.why);
  }
}

async function explainAndCheck(deps: DeepLaneDeps, rows: ClaimVerdict[], signal?: AbortSignal): Promise<Explanation> {
  const th = deps.content.thresholds;
  const kept = rows.flatMap((r) => r.judgments.map((j) => j.passage));
  const verdictLines = rows.map((r) => `- [${r.verdictLabel}] ${r.claim.text}`).join("\n");
  const passageText = kept.map((p, i) => `[${i + 1}] (${p.url}) ${p.text}`).join("\n\n");
  const verdictsForJev = rows.map((r) => ({ claim: r.claim.text, verdict: r.verdictLabel }));

  const check = async (sentences: string[]): Promise<Array<{ text: string; backed: boolean }>> => {
    if (sentences.length === 0) return [];
    const q: Questions = {};
    sentences.forEach((_, i) => {
      q[`s${i}`] = { type: "noul", instructions: { ...(deps.content.deep_lane.explanation_sentence_check.instructions as object), sentence: `sentences[${i}]` }, criteria: deps.content.deep_lane.explanation_sentence_check.criteria as never };
    });
    const res = await deps.jev.ask({ sentences, passages: kept.map((p) => p.text), verdicts: verdictsForJev }, q, { lane: "deep", step: "explain_check", signal });
    return sentences.map((text, i) => ({ text, backed: ((res.answers as Record<string, { noul?: number }>)[`s${i}`]?.noul ?? 0) >= th.explanation_confidence }));
  };

  let sentences = await helperExplain(deps.llm!, deps.prompts, verdictLines, passageText, signal);
  let checked = await check(sentences);
  if (checked.some((s) => !s.backed)) {
    // Regenerate once (PRD F13).
    sentences = await helperExplain(deps.llm!, deps.prompts, verdictLines, passageText, signal);
    checked = await check(sentences);
  }
  const survivors = checked.filter((s) => s.backed);
  const warning = survivors.length === 0 ? "The summary could not be tied to the sources and was removed." : survivors.length < checked.length ? "One sentence was removed because it could not be tied to the sources." : undefined;
  return { sentences: survivors, warning };
}

/** Check a helper answer sentence by sentence against passages (PRD F14d). */
export async function checkAnswerSentences(deps: Pick<DeepLaneDeps, "jev" | "content">, sentences: string[], passages: string[], signal?: AbortSignal): Promise<Array<{ text: string; backed: boolean }>> {
  if (sentences.length === 0) return [];
  const q: Questions = {};
  sentences.forEach((_, i) => {
    q[`s${i}`] = { type: "noul", instructions: { ...(deps.content.deep_lane.answer_sentence_check.instructions as object), sentence: `sentences[${i}]` }, criteria: deps.content.deep_lane.answer_sentence_check.criteria as never };
  });
  const res = await deps.jev.ask({ sentences, passages }, q, { lane: "helper", step: "answer_check", signal });
  return sentences.map((text, i) => ({ text, backed: ((res.answers as Record<string, { noul?: number }>)[`s${i}`]?.noul ?? 0) >= deps.content.thresholds.explanation_confidence }));
}

function finish(rows: ClaimVerdict[], pagesFetched: FetchedPage[], t0: number, firstVerdictMs: number | undefined, emit: Emit, explanation?: Explanation): DeepLaneResult {
  const counts = emptyCounts();
  for (const r of rows) counts[r.verdict]++;
  const result: DeepLaneResult = { claims: rows, counts, explanation, pagesFetched, timing: { firstVerdictMs, totalMs: Date.now() - t0 } };
  emit({ type: "done", result });
  return result;
}

function setUnsure(row: ClaimVerdict, V: QuestionContent["verdicts"], reason: string): void {
  row.verdict = "unsure";
  row.verdictLabel = V.unsure.label;
  row.unsureReason = reason;
  row.why = V.unsure_reasons[reason] ?? reason;
  row.band = "none";
  row.bandLabel = V.confidence_bands.none;
  row.best = undefined;
}

function withClaim(instructions: unknown, id: string): EntryType {
  const s = JSON.stringify(instructions).replace(/`claim\.(\w+)`/g, `\`claims.${id}.$1\``);
  return JSON.parse(s) as EntryType;
}

function fallbackClaims(text: string, max: number): ExtractedClaim[] {
  return splitSentences(text)
    .filter((s) => /\d/.test(s) || /https?:\/\//i.test(s))
    .slice(0, max)
    .map((s, i) => ({ id: `c${i + 1}`, text: s, quote: s, citedUrl: extractUrls(s)[0] }));
}

function pushPage(list: FetchedPage[], page: FetchedPage): void {
  if (!list.some((p) => p.url === page.url)) list.push(page);
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function emptyCounts(): Record<Verdict, number> {
  return { supported: 0, contradicted: 0, fabricated_quote: 0, mixed: 0, unsupported: 0, unsure: 0, not_checkable: 0, incidental: 0 };
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
