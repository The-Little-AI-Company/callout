/**
 * The LLM helper adapter (PRD 4a, F14b to F14e). One provider-agnostic
 * interface; the helper only extracts, transcribes, writes queries, and
 * explains. It never judges. Every sentence it produces for the screen is
 * checked by Jev before display.
 *
 * Two wire formats:
 *   - "openai": POST {baseURL}/chat/completions (DeepSeek default, any
 *     OpenAI-compatible endpoint). DeepSeek model ID confirmed from the live
 *     pricing page on 2026-09-17: `deepseek-flash` (served by DeepSeek-V4.1-Flash,
 *     vision supported, 1M context). See docs/DECISIONS.md for pricing.
 *   - "anthropic": POST {baseURL}/v1/messages (Anthropic API, or DeepSeek's
 *     Anthropic-format endpoint at https://api.deepseek.com/anthropic).
 *
 * Raw HTTP with an injected fetch is used instead of vendor SDKs because the
 * webview must route through the Tauri HTTP plugin to avoid CORS and the
 * default provider is not Anthropic. Recorded in docs/DECISIONS.md.
 */
import type { UsageLog } from "../usage";
import type { FetchLike } from "../fetch/readable";

export type LlmWire = "openai" | "anthropic";

export interface LlmConfig {
  wire: LlmWire;
  baseURL: string;
  apiKey: string;
  model: string;
  /** Optional stronger model for the explanation step (PLAN section 4). */
  explainModel?: string;
  timeoutMs?: number;
  /**
   * Reasoning mode. Off by default: the helper only extracts and transcribes,
   * and DeepSeek's thinking mode (on by default, live docs 2026-09-17) spends
   * the output budget on chain-of-thought before the JSON.
   */
  thinking?: "off" | "on";
}

export interface LlmImage {
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  base64: string;
}

export interface LlmRequest {
  system: string;
  user: string;
  images?: LlmImage[];
  /** Ask for a JSON object response. */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  step: string;
  lane?: "deep" | "helper" | "test";
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface LlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface LlmHelper {
  complete(req: LlmRequest): Promise<LlmResponse>;
  completeJson<T>(req: LlmRequest): Promise<T>;
  supportsImages(): boolean;
  test(): Promise<{ ok: true; ms: number; model: string } | { ok: false; error: string; status?: number }>;
  readonly config: LlmConfig;
}

export const PRESETS: Record<string, Omit<LlmConfig, "apiKey">> = {
  deepseek: { wire: "openai", baseURL: "https://api.deepseek.com", model: "deepseek-flash" },
  deepseek_anthropic: { wire: "anthropic", baseURL: "https://api.deepseek.com/anthropic", model: "deepseek-flash" },
  openai_compatible: { wire: "openai", baseURL: "https://api.openai.com/v1", model: "" },
  anthropic: { wire: "anthropic", baseURL: "https://api.anthropic.com", model: "claude-opus-5" },
};

export class LlmClient implements LlmHelper {
  constructor(
    readonly config: LlmConfig,
    private fetch: FetchLike,
    private usage: UsageLog,
  ) {}

  supportsImages(): boolean {
    // deepseek-flash supports vision (live docs 2026-09-17). Anthropic models do.
    // Unknown OpenAI-compatible models: assume yes and let the API say no.
    return true;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const model = req.model ?? this.config.model;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? this.config.timeoutMs ?? 60000);
    req.signal?.addEventListener("abort", () => controller.abort());
    try {
      const res = this.config.wire === "openai" ? await this.openai(req, model, controller.signal) : await this.anthropic(req, model, controller.signal);
      this.usage.record({ api: "llm", lane: req.lane ?? "helper", step: req.step, inputTokens: res.inputTokens, outputTokens: res.outputTokens, ms: Date.now() - started, model: res.model });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  async completeJson<T>(req: LlmRequest): Promise<T> {
    const res = await this.complete({ ...req, json: true });
    return parseJsonLoose<T>(res.text);
  }

  async test() {
    const started = Date.now();
    try {
      const r = await this.complete({ system: "Reply with the single word OK.", user: "Ping", maxTokens: 5, step: "key_test", lane: "test" });
      return { ok: true as const, ms: Date.now() - started, model: r.model };
    } catch (e) {
      return { ok: false as const, error: describeLlmError(e), status: (e as { status?: number }).status };
    }
  }

  private async openai(req: LlmRequest, model: string, signal: AbortSignal): Promise<LlmResponse> {
    const url = `${this.config.baseURL.replace(/\/$/, "")}/chat/completions`;
    const content: unknown[] = [{ type: "text", text: req.user }];
    for (const img of req.images ?? []) {
      content.push({ type: "image_url", image_url: { url: `data:${img.mediaType};base64,${img.base64}` } });
    }
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.images?.length ? content : req.user },
      ],
      max_tokens: req.maxTokens ?? 2048,
      temperature: req.temperature ?? 0,
      stream: false,
    };
    if (req.json) body.response_format = { type: "json_object" };
    if (isDeepSeek(this.config.baseURL)) body.thinking = { type: this.config.thinking === "on" ? "enabled" : "disabled" };
    const res = await this.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw await httpError(res);
    const data = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string | Array<{ type: string; text?: string }> }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const raw = data.choices?.[0]?.message?.content;
    const text = typeof raw === "string" ? raw : (raw ?? []).map((p) => p.text ?? "").join("");
    if (!text.trim() && data.choices?.[0]?.finish_reason === "length") {
      throw Object.assign(new Error("The helper ran out of output tokens before answering."), { status: 200 });
    }
    return { text, inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0, model: data.model ?? model };
  }

  private async anthropic(req: LlmRequest, model: string, signal: AbortSignal): Promise<LlmResponse> {
    const url = `${this.config.baseURL.replace(/\/$/, "")}/v1/messages`;
    const content: unknown[] = [];
    for (const img of req.images ?? []) {
      content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
    }
    content.push({ type: "text", text: req.json ? `${req.user}\n\nRespond with a single JSON object and nothing else.` : req.user });
    const body: Record<string, unknown> = {
      model,
      max_tokens: req.maxTokens ?? 2048,
      system: req.system,
      messages: [{ role: "user", content }],
    };
    // DeepSeek's Anthropic-format endpoint: `output_config.effort: "none"` disables thinking (live docs 2026-09-17).
    // Anthropic's own API: thinking is omitted; current models decide adaptively.
    if (isDeepSeek(this.config.baseURL)) body.output_config = { effort: this.config.thinking === "on" ? "high" : "none" };
    const res = await this.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.config.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw await httpError(res);
    const data = (await res.json()) as {
      model?: string;
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string;
    };
    const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    if (data.stop_reason === "refusal") throw Object.assign(new Error("The model declined this request."), { status: 200 });
    return { text, inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0, model: data.model ?? model };
  }
}

function isDeepSeek(baseURL: string): boolean {
  return /api\.deepseek\.com/i.test(baseURL);
}

async function httpError(res: Response): Promise<Error & { status: number }> {
  let detail = "";
  try {
    const j = (await res.json()) as { error?: { message?: string } | string; message?: string };
    detail = typeof j.error === "string" ? j.error : j.error?.message ?? j.message ?? "";
  } catch {
    // ignore
  }
  const err = new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`) as Error & { status: number };
  err.status = res.status;
  return err;
}

export function describeLlmError(e: unknown): string {
  const status = (e as { status?: number })?.status;
  if (status === 401 || status === 403) return "The key was rejected. Check it for typos and that the base URL matches the provider.";
  if (status === 404) return "The model or endpoint was not found. Check the model name and base URL.";
  if (status === 429) return "Rate limited or out of credit. Try again shortly.";
  if (status === 402) return "The provider reports no credit on this key.";
  if (e instanceof Error && e.name === "AbortError") return "The request timed out.";
  return e instanceof Error ? e.message : String(e);
}

/** Parse JSON that may be wrapped in a code fence or prose. */
export function parseJsonLoose<T>(text: string): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1]) return JSON.parse(fence[1].trim()) as T;
    const start = trimmed.search(/[[{]/);
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1)) as T;
    throw new Error("Helper did not return JSON");
  }
}
