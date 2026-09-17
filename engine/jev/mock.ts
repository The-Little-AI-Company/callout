/**
 * Scripted Jev for tests and the offline eval. Answers come from a function
 * of (question id, question, state), so tests can plant probabilities.
 */
import type { Questions, SystemOneResult, Question } from "@typesafe-ai/sdk";
import type { JevJudge, JevCallMeta } from "./client";
import type { UsageLog } from "../usage";

export type MockAnswerer = (id: string, question: Question, state: unknown, meta: JevCallMeta) => number | string | undefined;

export class MockJev implements JevJudge {
  calls: Array<{ state: unknown; questions: Questions; meta: JevCallMeta }> = [];
  constructor(private answer: MockAnswerer, private usage?: UsageLog, private latencyMs = 0) {}

  async ask<const Q extends Questions>(state: unknown, questions: Q, meta: JevCallMeta): Promise<SystemOneResult<Q>> {
    this.calls.push({ state, questions, meta });
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    const answers: Record<string, unknown> = {};
    for (const [id, q] of Object.entries(questions)) {
      const v = this.answer(id, q, state, meta);
      answers[id] = toAnswer(q, v);
    }
    const inputTokens = Math.ceil(JSON.stringify(state).length / 4) + Object.keys(questions).length * 30;
    this.usage?.record({ api: "typesafe", lane: meta.lane, step: meta.step, inputTokens, outputTokens: Object.keys(questions).length * 4, ms: this.latencyMs, model: "mock-jev" });
    return { model: "mock-jev", answers: answers as never, usage: { input_tokens: inputTokens, output_tokens: 0 } };
  }

  async test() {
    return { ok: true as const, ms: 1, model: "mock-jev" };
  }
}

function toAnswer(q: Question, v: number | string | undefined): unknown {
  if (q.type === "noul") {
    return { type: "noul", noul: typeof v === "number" ? v : 0.05 };
  }
  if (q.type === "choice") {
    const keys = Object.keys(q.criteria);
    const pick = typeof v === "string" && keys.includes(v) ? v : keys[0]!;
    const conf = 0.9;
    const probabilities: Record<string, number> = {};
    for (const k of keys) probabilities[k] = k === pick ? conf : (1 - conf) / Math.max(1, keys.length - 1);
    return { type: "choice", choice: pick, probabilities, confidence: conf };
  }
  const n = q.criteria.length;
  const idx = typeof v === "number" ? Math.max(0, Math.min(n - 1, Math.round(v))) : 0;
  const probabilities: Record<string, number> = {};
  const legend: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) {
    probabilities[String(i)] = i === idx ? 0.85 : 0.15 / Math.max(1, n - 1);
    legend[String(i)] = q.criteria[i];
  }
  return { type: "score", score: idx, probabilities, legend, confidence: 0.85 };
}
