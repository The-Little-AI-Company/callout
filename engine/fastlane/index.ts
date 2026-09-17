/**
 * Fast lane (PLAN section 3, PRD F5 to F8f).
 *
 * One Jev call with everything batched: content kind, factual signals, the
 * manipulation battery, manipulation level, worth-a-deep-check. A second,
 * small call picks the example sentence for the top techniques only.
 * Code owns every threshold; all wording comes from content/questions.yaml.
 */
import type { Questions } from "@typesafe-ai/sdk";
import type { JevJudge } from "../jev/client";
import type { QuestionContent, SignalSpec, TechniqueSpec } from "../content";
import type { Capture, ContentKind, FastLaneResult, Signal, Technique } from "../types";
import { splitSentences } from "../text/sentences";

export interface FastLaneOptions {
  /** Skip the example-sentence call (saves one round trip; techniques show without quotes). */
  skipExamples?: boolean;
  signal?: AbortSignal;
}

export function buildFastLaneQuestions(content: QuestionContent): Questions {
  const fl = content.fast_lane;
  const q: Questions = {
    content_kind: { type: "choice", instructions: fl.content_kind.instructions, criteria: fl.content_kind.criteria as never },
    worth_deep_check: { type: "choice", instructions: fl.worth_deep_check.instructions, criteria: fl.worth_deep_check.criteria as never },
    manipulation_level: { type: "score", instructions: fl.manipulation_level.instructions, criteria: fl.manipulation_level.criteria as never },
  };
  for (const s of fl.signals) q[`signal:${s.id}`] = noul(s);
  for (const t of fl.techniques) q[`technique:${t.id}`] = noul(t);
  return q;
}

function noul(spec: { instructions: unknown; criteria?: unknown }) {
  return { type: "noul" as const, instructions: spec.instructions as never, criteria: (spec.criteria ?? undefined) as never };
}

export async function runFastLane(
  jev: JevJudge,
  content: QuestionContent,
  capture: Capture,
  opts: FastLaneOptions = {},
): Promise<FastLaneResult> {
  const t0 = now();
  const th = content.thresholds;
  const fl = content.fast_lane;
  const state = {
    text: capture.text,
    source: { kind: capture.source.kind, url: capture.source.url, title: capture.source.title, ocr: capture.source.helperOutput },
  };

  const res = await jev.ask(state, buildFastLaneQuestions(content), { lane: "fast", step: "battery", signal: opts.signal });
  const jevMs = now() - t0;
  const a = res.answers as Record<string, { type: string; noul?: number; choice?: string; probabilities?: Record<string, number>; confidence?: number; score?: number }>;

  // Content kind and gating (F6, F8d).
  const kindAns = a.content_kind!;
  let contentKind = (kindAns.choice ?? "mixed") as ContentKind;
  const kindConfidence = kindAns.confidence ?? 0;
  if (kindConfidence < th.content_kind_min_confidence) contentKind = "mixed";
  const hideFactual = fl.content_kind.hide_factual_for.includes(contentKind);

  // Factual signals (F7).
  const signals: Signal[] = [];
  if (!hideFactual) {
    for (const spec of fl.signals) {
      const p = a[`signal:${spec.id}`]?.noul ?? 0;
      const shown = spec.invert ? 1 - p : p;
      if (shown >= th.signal_show) signals.push({ id: spec.id, label: spec.label, why: spec.why, probability: shown });
    }
    signals.sort((x, y) => y.probability - x.probability);
    signals.splice(th.signals_max_shown);
  }

  // Manipulation battery (F8a, F8b). Shown for every content kind.
  const detected: Technique[] = [];
  for (const spec of fl.techniques) {
    const p = a[`technique:${spec.id}`]?.noul ?? 0;
    if (p >= th.technique_show) detected.push({ id: spec.id, family: spec.family, label: spec.label, jargon: spec.jargon, probability: p });
  }
  detected.sort((x, y) => y.probability - x.probability);
  const techniques = detected.slice(0, th.techniques_max_shown);

  // Manipulation level (F8c).
  const lvl = a.manipulation_level!;
  const levelIndex = argmax(lvl.probabilities ?? {});
  const manipulationLevel = {
    index: levelIndex,
    label: fl.manipulation_level.labels[levelIndex] ?? fl.manipulation_level.labels[0] ?? "",
    score: lvl.score ?? 0,
    confidence: lvl.confidence ?? 0,
  };

  // Worth a deep check (F8).
  const wdc = a.worth_deep_check!;
  const worthDeepCheck = {
    choice: (wdc.choice ?? "unsure") as "yes" | "no" | "unsure",
    probabilities: wdc.probabilities ?? {},
  };
  const autoDeepCheck = !hideFactual && (worthDeepCheck.probabilities.yes ?? 0) >= th.worth_deep_check_auto;

  // Example sentences: second small call, only for techniques above threshold.
  let exampleMs = 0;
  if (techniques.length > 0 && !opts.skipExamples) {
    const t1 = now();
    try {
      await attachExamples(jev, content, capture.text, techniques, opts.signal);
    } catch {
      // Examples are optional. The technique still shows without a quote.
    }
    exampleMs = now() - t1;
  }

  return {
    header: fl.header,
    contentKind,
    contentKindLabel: fl.content_kind.labels[contentKind],
    contentKindConfidence: kindConfidence,
    factualHiddenReason: hideFactual ? fl.content_kind.hide_reason[contentKind] : undefined,
    signals,
    techniques,
    manipulationLevel,
    worthDeepCheck,
    autoDeepCheck,
    raw: res.answers as Record<string, unknown>,
    timing: { jevMs: Math.round(jevMs), exampleMs: Math.round(exampleMs), totalMs: Math.round(now() - t0) },
  };
}

/**
 * Jev returns probabilities, not spans. To quote an example, code splits the
 * text into numbered sentences and asks one Choice per technique over the
 * sentence list, with a none option (PLAN section 3).
 */
async function attachExamples(
  jev: JevJudge,
  content: QuestionContent,
  text: string,
  techniques: Technique[],
  signal?: AbortSignal,
): Promise<void> {
  const sentences = splitSentences(text).slice(0, 60);
  if (sentences.length < 2) {
    // A single sentence is its own example.
    for (const t of techniques) t.example = sentences[0];
    return;
  }
  const noneLabel = content.example_pick.none_label;
  const criteria: Record<string, null> = { [noneLabel]: null };
  sentences.forEach((_, i) => (criteria[String(i + 1)] = null));
  const specs = new Map<string, TechniqueSpec>(content.fast_lane.techniques.map((t) => [t.id, t]));
  const questions: Questions = {};
  for (const t of techniques) {
    const spec = specs.get(t.id)!;
    questions[t.id] = {
      type: "choice",
      instructions: { ...(content.example_pick.instructions as object), technique: { name: spec.jargon, definition: spec.criteria?.true ?? spec.instructions } },
      criteria,
    };
  }
  const state = { sentences: Object.fromEntries(sentences.map((s, i) => [String(i + 1), s])) };
  const res = await jev.ask(state, questions, { lane: "fast", step: "examples", signal });
  const min = content.thresholds.example_pick_min;
  for (const t of techniques) {
    const ans = (res.answers as Record<string, { choice?: string; probabilities?: Record<string, number> }>)[t.id];
    const pick = ans?.choice;
    if (!pick || pick === noneLabel) continue;
    if ((ans?.probabilities?.[pick] ?? 0) < min) continue;
    t.example = sentences[Number(pick) - 1];
  }
}

function argmax(p: Record<string, number>): number {
  let best = 0;
  let bestP = -1;
  for (const [k, v] of Object.entries(p)) {
    if (v > bestP) {
      bestP = v;
      best = Number(k);
    }
  }
  return best;
}

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export type { SignalSpec };
