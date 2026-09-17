import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { parseQuestionContent } from "@engine/content";
import { MockJev } from "@engine/jev/mock";
import { UsageLog } from "@engine/usage";
import { PageFetcher } from "@engine/fetch/readable";
import { runDeepLane, rollUp, checkAnswerSentences, computeMeter } from "@engine/deeplane";
import type { SearchClient } from "@engine/deeplane/search";
import type { LlmHelper, LlmRequest, LlmResponse } from "@engine/helper/llm";
import { parseHelperPrompts } from "@engine/helper/tasks";
import type { ClaimVerdict, DeepLaneEvent } from "@engine/types";

const content = parseQuestionContent(readFileSync("content/questions.yaml", "utf8"));
const prompts = parseHelperPrompts(readFileSync("content/helper-prompts.yaml", "utf8"));

const parseHtml = (html: string) => parseHTML(html).document as unknown as Document;

const page = (title: string, body: string) => `<html><head><title>${title}</title></head><body><article><h1>${title}</h1>${Array.from({ length: 6 }, () => `<p>${body}</p>`).join("")}</article></body></html>`;

const ROUTES: Record<string, string> = {
  "https://src.test/bridge": page("Bridge report", "The Harbor Bridge opened to traffic on 4 March 1932 after eight years of construction. The final cost was 6.25 million pounds. The council said the bridge would last a century."),
  "https://src.test/other": page("Unrelated", "Gardening tips for spring. Plant tomatoes after the last frost. Water deeply once a week."),
};

const fetcher = new PageFetcher({
  fetch: async (url: string) => (ROUTES[url] ? new Response(ROUTES[url], { headers: { "content-type": "text/html" } }) : new Response("", { status: 404 })),
  parseHtml,
});

const search: SearchClient = {
  async search(q) {
    return /bridge/i.test(q) ? [{ url: "https://src.test/bridge", title: "Bridge report", content: "", score: 0.9 }, { url: "https://src.test/other", title: "Unrelated", content: "", score: 0.2 }] : [];
  },
  async test() {
    return { ok: true, ms: 1 };
  },
};

/** Scripted helper: returns claims, queries, and an explanation with one planted unbacked sentence. */
function scriptedLlm(script: { explainRounds?: string[][] } = {}, usage?: UsageLog): LlmHelper & { calls: LlmRequest[] } {
  const rounds = script.explainRounds ?? [["One claim was supported by a fetched source and one was contradicted.", "The bridge was also painted gold."], ["One claim was supported by a fetched source and one was contradicted.", "The cost claim was contradicted."]];
  let explainCall = 0;
  const calls: LlmRequest[] = [];
  return {
    calls,
    config: { wire: "openai", baseURL: "x", apiKey: "k", model: "mock" },
    supportsImages: () => true,
    async test() {
      return { ok: true, ms: 1, model: "mock" };
    },
    async complete(req): Promise<LlmResponse> {
      calls.push(req);
      usage?.record({ api: "llm", lane: req.lane ?? "helper", step: req.step, inputTokens: 10, outputTokens: 5, ms: 1, model: "mock" });
      let text = "{}";
      if (req.step === "extract_claims") {
        text = JSON.stringify({
          claims: [
            { text: "The Harbor Bridge opened in 1932.", quote: "The Harbor Bridge opened in 1932" },
            { text: "The bridge cost 60 million pounds.", quote: "cost 60 million pounds" },
            { text: "Bridges are beautiful.", quote: "Bridges are beautiful" },
            { text: "Fabricated claim.", quote: "this quote is nowhere in the text" },
          ],
        });
      } else if (req.step === "write_queries") {
        text = JSON.stringify({ queries: ["harbor bridge opened 1932", "harbor bridge cost"] });
      } else if (req.step === "explain") {
        text = JSON.stringify({ sentences: rounds[Math.min(explainCall++, rounds.length - 1)] });
      } else if (req.step === "judge") {
        text = JSON.stringify({
          claims: [
            { id: "c1", call: "likely_true", reason: "Matches the record." },
            { id: "c2", call: "likely_false", reason: "The cost was far lower." },
          ],
          overall: { false_share: 50, intent: "careless", writeup: ["The opening date holds up and the cost claim is contradicted.", "The bridge is made of cheese."] },
        });
      }
      return { text, inputTokens: 10, outputTokens: 5, model: "mock" };
    },
    async completeJson<T>(req: LlmRequest): Promise<T> {
      return JSON.parse((await this.complete(req)).text) as T;
    },
  };
}

/** Scripted Jev: judges by keyword, so the pipeline is exercised end to end. */
function scriptedJev(usage?: UsageLog) {
  return new MockJev((id, q, state) => {
    const st = state as { claims?: Record<string, { text: string }>; claim?: string; passages?: string[]; sentences?: string[] };
    if (id.startsWith("checkable:")) return /beautiful/i.test(st.claims![id.split(":")[1]!]!.text) ? 0.1 : 0.95;
    if (id.startsWith("central:")) return 0.9;
    if (id.startsWith("faithful:")) return 0.95;
    if (q.type === "score" && id.startsWith("p")) {
      const p = st.passages![Number(id.slice(1))]!;
      return /bridge/i.test(p) ? 3 : 0;
    }
    if (q.type === "choice" && id.startsWith("s")) {
      const p = st.passages![Number(id.slice(1))]!;
      if (/1932/.test(st.claim!) && /1932/.test(p)) return "supports";
      if (/60 million/.test(st.claim!) && /6\.25 million/.test(p)) return "contradicts";
      return "says_nothing";
    }
    if (q.type === "noul" && id.startsWith("s")) {
      const s = st.sentences![Number(id.slice(1))]!;
      return /gold|cheese/i.test(s) ? 0.05 : 0.95;
    }
    return 0.1;
  }, usage);
}

const TEXT = "Everyone knows the Harbor Bridge opened in 1932 and cost 60 million pounds. Bridges are beautiful.";

describe("deep lane", () => {
  it("produces verdicts with sources, drops fabricated quotes, checks the explanation", async () => {
    const usage = new UsageLog();
    const llm = scriptedLlm({}, usage);
    const events: DeepLaneEvent[] = [];
    const result = await runDeepLane({ jev: scriptedJev(usage), content, llm, prompts, fetcher, search, online: true }, { text: TEXT }, (e) => events.push(e));

    // Substring prefilter (F9): the fabricated claim never appears.
    expect(result.claims.map((c) => c.claim.text)).not.toContain("Fabricated claim.");
    const by = Object.fromEntries(result.claims.map((c) => [c.claim.text, c]));

    const opened = by["The Harbor Bridge opened in 1932."]!;
    expect(opened.verdict).toBe("supported");
    expect(opened.best?.passage.url).toBe("https://src.test/bridge"); // F20: verdict with shown source
    expect(opened.why).toBe(content.verdicts.supported.why);

    const cost = by["The bridge cost 60 million pounds."]!;
    expect(cost.verdict).toBe("contradicted");
    expect(cost.best?.passage.text).toMatch(/6\.25 million/);

    expect(by["Bridges are beautiful."]!.verdict).toBe("not_checkable");

    // Helper judgement: labeled calls on rows, write-up checked by Jev (cheese sentence dropped), meter from the rows.
    expect(cost.helper).toMatchObject({ call: "likely_false", label: "Likely false" });
    expect(llm.calls.filter((c) => c.step === "judge").length).toBe(1);
    expect(result.judgement?.sentences.map((s) => s.text)).toEqual(["The opening date holds up and the cost claim is contradicted."]);
    expect(result.judgement?.warning).toMatch(/removed/);
    expect(result.meter).toMatchObject({ level: "mixed", percent: 50, judged: 2, falseCount: 1, trueCount: 1 });

    // Events stream: claims first, then per-claim updates, then explanation, then done.
    expect(events[0]!.type).toBe("status");
    expect(events.some((e) => e.type === "claims")).toBe(true);
    expect(events.at(-1)!.type).toBe("done");

    // Usage logged per lane and step (PLAN 5).
    const steps = new Set(usage.byLaneAndStep().map((r) => `${r.api}:${r.step}`));
    for (const s of ["typesafe:claim_gate", "typesafe:rerank", "typesafe:support", "typesafe:writeup_check", "llm:extract_claims", "llm:write_queries", "llm:judge"]) expect(steps.has(s), s).toBe(true);
    expect(result.pagesFetched.map((p) => p.url)).toContain("https://src.test/bridge");
  });

  it("marks a fabricated quote when the cited source lacks the quoted words", async () => {
    const llm = scriptedLlm();
    llm.complete = async (req) => ({
      text: req.step === "extract_claims" ? JSON.stringify({ claims: [{ text: "The council said the bridge would fall within a decade.", quote: 'said "the bridge would fall within a decade"', attributed_quote: "the bridge would fall within a decade", cited_url: "https://src.test/bridge" }] }) : "{}",
      inputTokens: 1,
      outputTokens: 1,
      model: "mock",
    });
    const text = 'The council said "the bridge would fall within a decade" (https://src.test/bridge).';
    const result = await runDeepLane({ jev: scriptedJev(), content, llm, prompts, fetcher, search, online: true }, { text }, () => {});
    expect(result.claims[0]!.verdict).toBe("fabricated_quote");
    expect(result.claims[0]!.best?.passage.url).toBe("https://src.test/bridge");
  });

  it("is honest offline and without a search key", async () => {
    const llm = scriptedLlm();
    const offline = await runDeepLane({ jev: scriptedJev(), content, llm, prompts, fetcher, search, online: false }, { text: TEXT }, () => {});
    for (const c of offline.claims.filter((c) => c.verdict !== "not_checkable")) {
      expect(c.verdict).toBe("unsure");
      expect(c.why).toBe(content.verdicts.unsure_reasons.offline);
    }
    const noSearch = await runDeepLane({ jev: scriptedJev(), content, llm, prompts, fetcher, online: true }, { text: TEXT }, () => {});
    for (const c of noSearch.claims.filter((c) => c.verdict !== "not_checkable")) {
      expect(c.verdict).toBe("unsure");
      expect(c.unsureReason).toBe("no_search_key");
    }
  });

  it("roll-up: no green without support, no red without contradiction, low confidence is unsure", () => {
    const mk = (relation: "supports" | "contradicts" | "says_nothing", confidence: number) => ({ passage: { id: "p", url: "u", text: "t", index: 0 }, relevance: 3, relation, probabilities: {}, confidence });
    const row = (js: ReturnType<typeof mk>[]): ClaimVerdict => ({ claim: { id: "c1", text: "x", quote: "x" }, checkable: 1, central: 1, verdict: "unsure", verdictLabel: "", why: "", band: "none", bandLabel: "", judgments: js, thresholds: { support_confidence: 0.8 } });
    let r = row([mk("supports", 0.95)]);
    rollUp(r, content);
    expect(r.verdict).toBe("supported");
    r = row([mk("supports", 0.95), mk("contradicts", 0.9)]);
    rollUp(r, content);
    expect(r.verdict).toBe("contradicted");
    r = row([mk("supports", 0.6)]);
    rollUp(r, content);
    expect(r.verdict).toBe("unsure");
    expect(r.unsureReason).toBe("low_confidence");
    r = row([mk("says_nothing", 0.9)]);
    rollUp(r, content);
    expect(r.verdict).toBe("unsupported");
    r = row([mk("supports", 0.9), mk("contradicts", 0.5)]);
    rollUp(r, content);
    expect(r.verdict).toBe("mixed");
  });

  it("meter: flame for lies, smoke for mostly false, halo for holds up, unknown when nothing judged", () => {
    const row = (verdict: ClaimVerdict["verdict"], helper?: ClaimVerdict["helper"]): ClaimVerdict => ({ claim: { id: "c", text: "x", quote: "x" }, checkable: 1, central: 1, verdict, verdictLabel: verdict, why: "", band: "none", bandLabel: "", judgments: [], thresholds: { support_confidence: 0.8 }, helper });
    const lf = { call: "likely_false" as const, label: "Likely false", reason: "" };
    const lt = { call: "likely_true" as const, label: "Likely true", reason: "" };
    expect(computeMeter([row("contradicted"), row("unsupported", lf)], content).level).toBe("pants_on_fire");
    expect(computeMeter([row("contradicted"), row("unsupported", lf), row("supported")], content).level).toBe("smoke");
    expect(computeMeter([row("contradicted"), row("supported")], content, "deceptive").level).toBe("mixed");
    expect(computeMeter([row("contradicted"), row("contradicted"), row("supported")], content, "deceptive").level).toBe("pants_on_fire");
    expect(computeMeter([row("supported"), row("unsupported", lt)], content).level).toBe("holds_up");
    // A helper call never overrides a sourced verdict.
    expect(computeMeter([row("supported", lf)], content).falseCount).toBe(0);
    expect(computeMeter([row("not_checkable")], content).level).toBe("unknown");
    expect(computeMeter([row("unsure")], content, "unclear", 80).level).toBe("smoke");
  });

  it("checks helper answer sentences against passages (F14d)", async () => {
    const out = await checkAnswerSentences({ jev: scriptedJev(), content }, ["The bridge opened in 1932.", "It was painted gold."], ["The bridge opened in 1932."]);
    expect(out.map((s) => s.backed)).toEqual([true, false]);
  });
});
