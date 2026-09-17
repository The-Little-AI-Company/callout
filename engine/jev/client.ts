/**
 * The one interface every Jev question goes through (PLAN section 5: keep it
 * swappable). Wraps @typesafe-ai/sdk, logs usage per call with lane and step.
 *
 * API contract from https://docs.typesafe.ai/api (read 2026-09-17):
 *   POST /v1/systemone { state, model, questions } -> { model, answers, usage }
 */
import { TypeSafeClient, type Questions, type SystemOneResult, type Fetch } from "@typesafe-ai/sdk";
import type { UsageLog } from "../usage";
import type { UsageEntry } from "../types";

export type JevLane = UsageEntry["lane"];

export interface JevCallMeta {
  lane: JevLane;
  step: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface JevJudge {
  ask<const Q extends Questions>(state: unknown, questions: Q, meta: JevCallMeta): Promise<SystemOneResult<Q>>;
  /** Cheap connectivity and key check for the settings wizard. */
  test(): Promise<{ ok: true; ms: number; model: string } | { ok: false; error: string; status?: number }>;
}

export interface JevClientOptions {
  apiKey: string;
  model?: string;
  fetch?: Fetch;
  usage: UsageLog;
  baseURL?: string;
  timeoutMs?: number;
}

export class JevClient implements JevJudge {
  private client: TypeSafeClient;
  private usage: UsageLog;
  readonly model: string;

  constructor(opts: JevClientOptions) {
    this.model = opts.model ?? "jev-latest";
    this.usage = opts.usage;
    this.client = new TypeSafeClient({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      defaultModel: this.model,
      timeout: opts.timeoutMs ?? 15000,
      fetch: opts.fetch,
      logLevel: "off",
      // The engine runs inside the Tauri webview. Keys never leave the machine
      // except to api.typesafe.ai, so browser use is the intended deployment.
      dangerouslyAllowBrowser: true,
    });
  }

  async ask<const Q extends Questions>(state: unknown, questions: Q, meta: JevCallMeta): Promise<SystemOneResult<Q>> {
    const started = now();
    const res = await this.client.systemOne(
      { state: state as never, questions, model: this.model },
      { timeout: meta.timeoutMs, signal: meta.signal },
    );
    this.usage.record({
      api: "typesafe",
      lane: meta.lane,
      step: meta.step,
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
      ms: Math.round(now() - started),
      model: res.model,
    });
    return res;
  }

  async test(): Promise<{ ok: true; ms: number; model: string } | { ok: false; error: string; status?: number }> {
    const started = now();
    try {
      const res = await this.ask(
        "The sky is blue.",
        { is_statement: { type: "noul", instructions: "Is this a statement rather than a question?" } },
        { lane: "test", step: "key_test", timeoutMs: 10000 },
      );
      return { ok: true, ms: Math.round(now() - started), model: res.model };
    } catch (e) {
      return { ok: false, error: describeError(e), status: (e as { status?: number })?.status };
    }
  }
}

export function describeError(e: unknown): string {
  if (e && typeof e === "object") {
    const err = e as { status?: number; message?: string; name?: string };
    if (err.status === 401) return "The key was rejected (401). Check it for typos.";
    if (err.status === 422) return "The request was malformed (422). This is a bug in Callout, not your key.";
    if (err.status === 429) return "Rate limited (429). Wait a moment and try again.";
    if (err.status === 529) return "The service is overloaded (529). Try again shortly.";
    if (err.name === "APIConnectionError" || err.name === "APITimeoutError") return "Could not reach the service. Check your connection.";
    if (err.message) return err.message;
  }
  return String(e);
}

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
