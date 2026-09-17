/**
 * Web search through Tavily with the user's own key (PRD F14a).
 *
 * The official @tavily/core SDK depends on axios and cannot be routed through
 * the Tauri HTTP plugin, which the webview needs to avoid CORS. This is a
 * thin client on the documented REST endpoint (POST https://api.tavily.com/search)
 * with an injected fetch. Recorded in docs/DECISIONS.md.
 */
import type { UsageLog } from "../usage";
import type { FetchLike } from "../fetch/readable";

export interface SearchResult {
  url: string;
  title: string;
  /** Tavily's extracted content snippet. Used as a passage when the page cannot be fetched. */
  content: string;
  score: number;
}

export interface SearchClient {
  search(query: string, opts?: { maxResults?: number; signal?: AbortSignal }): Promise<SearchResult[]>;
  test(): Promise<{ ok: true; ms: number } | { ok: false; error: string; status?: number }>;
}

export class TavilyClient implements SearchClient {
  constructor(
    private apiKey: string,
    private fetch: FetchLike,
    private usage: UsageLog,
    private baseURL = "https://api.tavily.com",
    private cache: Map<string, SearchResult[]> = new Map(),
  ) {}

  async search(query: string, opts: { maxResults?: number; signal?: AbortSignal } = {}): Promise<SearchResult[]> {
    const key = `${opts.maxResults ?? 5}|${query}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const started = Date.now();
    const res = await this.fetch(`${this.baseURL}/search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        query,
        max_results: opts.maxResults ?? 5,
        search_depth: "basic",
        include_answer: false,
        include_raw_content: false,
      }),
      signal: opts.signal,
    });
    this.usage.record({ api: "tavily", lane: "deep", step: "search", inputTokens: 0, outputTokens: 0, ms: Date.now() - started });
    if (!res.ok) {
      const err = new Error(`Tavily HTTP ${res.status}`) as Error & { status: number };
      err.status = res.status;
      throw err;
    }
    const body = (await res.json()) as { results?: Array<{ url: string; title: string; content: string; score: number }> };
    const results = (body.results ?? []).map((r) => ({ url: r.url, title: r.title ?? "", content: r.content ?? "", score: r.score ?? 0 }));
    this.cache.set(key, results);
    return results;
  }

  async test() {
    const started = Date.now();
    try {
      await this.search("callout key test", { maxResults: 1 });
      return { ok: true as const, ms: Date.now() - started };
    } catch (e) {
      const status = (e as { status?: number }).status;
      const error = status === 401 || status === 403 ? "The key was rejected. Check it for typos." : status === 429 ? "Rate limited. Try again shortly." : e instanceof Error ? e.message : String(e);
      return { ok: false as const, error, status };
    }
  }
}
