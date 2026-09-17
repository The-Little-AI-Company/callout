/**
 * Helper tasks: the only things the LLM does. Prompts come from
 * content/helper-prompts.yaml. Outputs are labeled helper output and never
 * shown as verdicts (PRD F14c).
 */
import { parse } from "yaml";
import type { LlmHelper, LlmImage } from "./llm";
import type { ExtractedClaim } from "../types";
import { containsQuote, normalize } from "../text/sentences";

export interface HelperPrompts {
  [task: string]: { system: string; user: string };
}

export function parseHelperPrompts(yamlText: string): HelperPrompts {
  return parse(yamlText) as HelperPrompts;
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ""));
}

export interface RawClaim {
  text: string;
  quote: string;
  attributed_quote?: string | null;
  cited_url?: string | null;
}

/**
 * Claim extraction plus the substring prefilter (PRD F9, PLAN 4.1). Any claim
 * whose quote is not a substring of the source text is dropped before display.
 */
export async function extractClaims(llm: LlmHelper, prompts: HelperPrompts, text: string, maxClaims: number, signal?: AbortSignal): Promise<{ kept: ExtractedClaim[]; dropped: RawClaim[] }> {
  const p = prompts.extract_claims!;
  const out = await llm.completeJson<{ claims?: RawClaim[] }>({
    system: fill(p.system, { max_claims: maxClaims }),
    user: fill(p.user, { text }),
    step: "extract_claims",
    lane: "deep",
    maxTokens: 2048,
    signal,
  });
  return prefilterClaims(out.claims ?? [], text, maxClaims);
}

export function prefilterClaims(raw: RawClaim[], text: string, maxClaims: number): { kept: ExtractedClaim[]; dropped: RawClaim[] } {
  const kept: ExtractedClaim[] = [];
  const dropped: RawClaim[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    if (!c || typeof c.text !== "string" || typeof c.quote !== "string") continue;
    const key = normalize(c.text).toLowerCase();
    if (seen.has(key)) continue;
    if (!containsQuote(text, c.quote)) {
      dropped.push(c);
      continue;
    }
    seen.add(key);
    kept.push({
      id: `c${kept.length + 1}`,
      text: c.text.trim(),
      quote: c.quote.trim(),
      attributedQuote: c.attributed_quote?.trim() || undefined,
      citedUrl: c.cited_url && /^https?:\/\//i.test(c.cited_url) ? c.cited_url.trim() : undefined,
    });
    if (kept.length >= maxClaims) break;
  }
  return { kept, dropped };
}

export async function writeQueries(llm: LlmHelper, prompts: HelperPrompts, claim: string, context: string, maxQueries: number, signal?: AbortSignal): Promise<string[]> {
  const p = prompts.write_queries!;
  const out = await llm.completeJson<{ queries?: string[] }>({
    system: fill(p.system, { max_queries: maxQueries }),
    user: fill(p.user, { claim, context: context.slice(0, 600) }),
    step: "write_queries",
    lane: "deep",
    maxTokens: 300,
    signal,
  });
  return (out.queries ?? []).filter((q) => typeof q === "string" && q.trim()).slice(0, maxQueries);
}

export async function explain(llm: LlmHelper, prompts: HelperPrompts, verdicts: string, passages: string, signal?: AbortSignal): Promise<string[]> {
  const p = prompts.explain!;
  const out = await llm.completeJson<{ sentences?: string[] }>({
    system: p.system,
    user: fill(p.user, { verdicts, passages }),
    step: "explain",
    lane: "deep",
    model: llm.config.explainModel,
    maxTokens: 400,
    signal,
  });
  return (out.sentences ?? []).filter((s) => typeof s === "string" && s.trim()).slice(0, 3);
}

export async function answerQuestion(llm: LlmHelper, prompts: HelperPrompts, question: string, passages: string, signal?: AbortSignal): Promise<string[]> {
  const p = prompts.answer_question!;
  const out = await llm.completeJson<{ sentences?: string[] }>({
    system: p.system,
    user: fill(p.user, { question, passages }),
    step: "answer_question",
    lane: "helper",
    maxTokens: 500,
    signal,
  });
  return (out.sentences ?? []).filter((s) => typeof s === "string" && s.trim()).slice(0, 5);
}

export async function cleanPaste(llm: LlmHelper, prompts: HelperPrompts, text: string, signal?: AbortSignal): Promise<Array<{ speaker?: string; text: string }>> {
  const p = prompts.clean_paste!;
  const out = await llm.completeJson<{ items?: Array<{ speaker?: string | null; text: string }> }>({
    system: p.system,
    user: fill(p.user, { text }),
    step: "clean_paste",
    lane: "helper",
    maxTokens: 2048,
    signal,
  });
  return (out.items ?? []).filter((i) => i && typeof i.text === "string").map((i) => ({ speaker: i.speaker ?? undefined, text: i.text }));
}

export async function transcribeImage(llm: LlmHelper, prompts: HelperPrompts, image: LlmImage, signal?: AbortSignal): Promise<string> {
  const p = prompts.transcribe_image!;
  const out = await llm.completeJson<{ text?: string }>({ system: p.system, user: p.user, images: [image], step: "transcribe_image", lane: "helper", maxTokens: 4096, signal });
  return (out.text ?? "").trim();
}

export async function transcribeFrames(llm: LlmHelper, prompts: HelperPrompts, frames: LlmImage[], signal?: AbortSignal): Promise<string> {
  const p = prompts.transcribe_video_frames!;
  const out = await llm.completeJson<{ text?: string }>({ system: p.system, user: p.user, images: frames, step: "transcribe_frames", lane: "helper", maxTokens: 4096, signal });
  return (out.text ?? "").trim();
}
