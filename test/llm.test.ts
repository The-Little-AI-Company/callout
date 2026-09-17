import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LlmClient, parseJsonLoose, PRESETS } from "@engine/helper/llm";
import { parseHelperPrompts, prefilterClaims, extractClaims } from "@engine/helper/tasks";
import { UsageLog } from "@engine/usage";

const prompts = parseHelperPrompts(readFileSync("content/helper-prompts.yaml", "utf8"));

describe("LlmClient wire formats", () => {
  it("speaks OpenAI-compatible chat completions with JSON mode and images", async () => {
    let seen: { url: string; body: Record<string, unknown>; headers: Record<string, string> } | undefined;
    const fetch = async (url: string, init?: RequestInit) => {
      seen = { url, body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> };
      return new Response(JSON.stringify({ model: "deepseek-flash", choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }), { headers: { "content-type": "application/json" } });
    };
    const usage = new UsageLog();
    const llm = new LlmClient({ ...PRESETS.deepseek!, apiKey: "k" }, fetch, usage);
    const out = await llm.completeJson<{ ok: boolean }>({ system: "s", user: "u", images: [{ mediaType: "image/png", base64: "AAAA" }], step: "t" });
    expect(out.ok).toBe(true);
    expect(seen!.url).toBe("https://api.deepseek.com/chat/completions");
    expect(seen!.headers.authorization).toBe("Bearer k");
    expect(seen!.body.response_format).toEqual({ type: "json_object" });
    const msgs = seen!.body.messages as Array<{ role: string; content: unknown }>;
    expect(Array.isArray(msgs[1]!.content)).toBe(true);
    expect(usage.totals("llm")).toMatchObject({ calls: 1, inputTokens: 10, outputTokens: 2 });
  });

  it("speaks the Anthropic messages format", async () => {
    let seen: { url: string; body: Record<string, unknown>; headers: Record<string, string> } | undefined;
    const fetch = async (url: string, init?: RequestInit) => {
      seen = { url, body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> };
      return new Response(JSON.stringify({ model: "claude-opus-5", content: [{ type: "text", text: "```json\n{\"a\":1}\n```" }], usage: { input_tokens: 5, output_tokens: 1 }, stop_reason: "end_turn" }), { headers: { "content-type": "application/json" } });
    };
    const llm = new LlmClient({ ...PRESETS.anthropic!, apiKey: "k" }, fetch, new UsageLog());
    const out = await llm.completeJson<{ a: number }>({ system: "s", user: "u", step: "t" });
    expect(out.a).toBe(1);
    expect(seen!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen!.headers["x-api-key"]).toBe("k");
    expect(seen!.headers["anthropic-version"]).toBe("2023-06-01");
    expect(seen!.body.system).toBe("s");
  });

  it("describes a rejected key clearly", async () => {
    const fetch = async () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 });
    const llm = new LlmClient({ ...PRESETS.deepseek!, apiKey: "k" }, fetch, new UsageLog());
    const r = await llm.test();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/rejected/);
  });

  it("parseJsonLoose handles fences and prose", () => {
    expect(parseJsonLoose('Sure: {"x":1} done')).toEqual({ x: 1 });
    expect(() => parseJsonLoose("nothing")).toThrow();
  });
});

describe("claim prefilter (PRD F9)", () => {
  it("drops any claim whose quote is not in the source text", () => {
    const text = "The bridge opened in 1932. It cost “forty million” dollars.";
    const r = prefilterClaims(
      [
        { text: "The bridge opened in 1932", quote: "The bridge opened in 1932." },
        { text: "It cost forty million dollars", quote: 'It cost "forty million" dollars.' },
        { text: "Made up", quote: "This sentence is not in the text." },
        { text: "The bridge opened in 1932", quote: "The bridge opened in 1932." },
      ],
      text,
      6,
    );
    expect(r.kept.map((c) => c.text)).toEqual(["The bridge opened in 1932", "It cost forty million dollars"]);
    expect(r.dropped.length).toBe(1);
  });
});

const key = process.env.DEEPSEEK_API_KEY;
describe.skipIf(!key)("live DeepSeek helper", () => {
  it("extracts claims with exact quotes from a sample", async () => {
    const llm = new LlmClient({ ...PRESETS.deepseek!, apiKey: key! }, fetch, new UsageLog());
    const text = "The city council said the new bridge opened on Tuesday after three years of construction. Officials claim it cost 40 million dollars. Honestly, it looks ugly.";
    const r = await extractClaims(llm, prompts, text, 6);
    expect(r.kept.length).toBeGreaterThanOrEqual(1);
    for (const c of r.kept) expect(text.toLowerCase()).toContain(c.quote.toLowerCase().replace(/\s+/g, " ").slice(0, 20));
    console.log("live extract:", r.kept, "dropped:", r.dropped);
  }, 60000);
});

describe("repairJson", () => {
  it("closes a missing array bracket before matching object closers", () => {
    expect(parseJsonLoose('{"overall":{"writeup":["a","b"}}')).toEqual({ overall: { writeup: ["a", "b"] } });
  });
  it("closes truncated output", () => {
    expect(parseJsonLoose('{"claims":[{"id":"c1","call":"likely_false","reason":"cut off')).toEqual({ claims: [{ id: "c1", call: "likely_false", reason: "cut off" }] });
  });
});
