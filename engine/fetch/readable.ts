/**
 * Page fetching and readable-text extraction (PRD F3, F11).
 *
 * `fetch` and `parseHtml` are injected: in the webview they are the Tauri
 * HTTP plugin (no CORS) and the native DOMParser; in Node tests they are
 * global fetch and linkedom. Paywalled and blocked pages are reported as
 * such, never guessed (PRD section 10).
 */
import { Readability } from "@mozilla/readability";
import type { FetchedPage } from "../types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type ParseHtml = (html: string, url: string) => Document;

export interface PageFetcherOptions {
  fetch: FetchLike;
  parseHtml: ParseHtml;
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
  cache?: Map<string, FetchedPage>;
}

const PAYWALL_HINTS = /subscribe to continue|subscription required|to continue reading|create a free account|sign in to read|this content is for subscribers|paywall/i;

export class PageFetcher {
  private cache: Map<string, FetchedPage>;
  constructor(private opts: PageFetcherOptions) {
    this.cache = opts.cache ?? new Map();
  }

  async fetchPage(url: string): Promise<FetchedPage> {
    const cached = this.cache.get(url);
    if (cached) return cached;
    const page = await this.fetchUncached(url);
    this.cache.set(url, page);
    return page;
  }

  private async fetchUncached(url: string): Promise<FetchedPage> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 8000);
    try {
      const res = await this.opts.fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "user-agent": this.opts.userAgent ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Callout/0.1 (+https://github.com/little-ai-company/callout)",
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        },
      });
      if (res.status === 401 || res.status === 402 || res.status === 403) {
        return { url, finalUrl: res.url || undefined, text: "", status: "paywalled", error: `HTTP ${res.status}` };
      }
      if (!res.ok) return { url, finalUrl: res.url || undefined, text: "", status: "failed", error: `HTTP ${res.status}` };
      const type = res.headers.get("content-type") ?? "";
      const raw = await readLimited(res, this.opts.maxBytes ?? 2_000_000);
      if (type.includes("text/plain")) {
        return { url, finalUrl: res.url || undefined, text: cleanText(raw), status: raw.trim() ? "ok" : "empty" };
      }
      if (!type.includes("html") && !type.includes("xml") && !looksLikeHtml(raw)) {
        return { url, finalUrl: res.url || undefined, text: "", status: "failed", error: `Unsupported content type ${type || "unknown"}` };
      }
      const { title, text } = extractReadable(raw, res.url || url, this.opts.parseHtml);
      if (!text.trim()) return { url, finalUrl: res.url || undefined, title, text: "", status: "empty", error: "No readable text (JavaScript-only page?)" };
      if (text.length < 600 && PAYWALL_HINTS.test(raw)) {
        return { url, finalUrl: res.url || undefined, title, text, status: "paywalled", error: "Page asks for a subscription or sign-in" };
      }
      return { url, finalUrl: res.url || undefined, title, text, status: "ok" };
    } catch (e) {
      const msg = e instanceof Error ? (e.name === "AbortError" ? "Timed out" : e.message) : String(e);
      return { url, text: "", status: "failed", error: msg };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function extractReadable(html: string, url: string, parseHtml: ParseHtml): { title?: string; text: string } {
  try {
    const doc = parseHtml(html, url);
    const article = new Readability(doc as never, { charThreshold: 200 }).parse();
    if (article?.textContent && article.textContent.trim().length > 200) {
      return { title: article.title || undefined, text: cleanText(article.textContent) };
    }
    const title = doc.querySelector("title")?.textContent?.trim() || undefined;
    return { title, text: cleanText(stripHtml(html)) };
  } catch {
    return { text: cleanText(stripHtml(html)) };
  }
}

/** Fallback when Readability gives up: strip tags, drop script/style/nav. */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(nav|header|footer|aside|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

export function cleanText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

function looksLikeHtml(s: string): boolean {
  return /<html|<body|<div|<p[\s>]/i.test(s.slice(0, 5000));
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total >= maxBytes) {
      void reader.cancel();
      break;
    }
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}
