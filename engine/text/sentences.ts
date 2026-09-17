/**
 * Text utilities: sentence splitting, whitespace and quote normalization,
 * substring checks. All plain code; no model involved.
 */

const ABBREVIATIONS = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|U\.S|U\.K|Inc|Ltd|Co|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.$/;

/** Split text into sentences. Keeps line breaks as boundaries. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\n+/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    let buf = "";
    const tokens = trimmed.split(/(?<=[.!?…]["'”’)\]]?)\s+/);
    for (const t of tokens) {
      buf = buf ? `${buf} ${t}` : t;
      if (ABBREVIATIONS.test(buf) || /\b\d+\.$/.test(buf)) continue;
      out.push(buf);
      buf = "";
    }
    if (buf) out.push(buf);
  }
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Collapse whitespace, fold curly quotes and dashes, so quotes match across line wraps. */
export function normalize(text: string): string {
  return text
    .replace(/[“”„″]/g, '"')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[–—−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Case-insensitive, normalized substring test. */
export function containsQuote(haystack: string, quote: string): boolean {
  const q = normalize(quote).toLowerCase();
  if (q.length === 0) return false;
  return normalize(haystack).toLowerCase().includes(q);
}

/** Truncate to a character budget at a sentence boundary when possible. */
export function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const head = text.slice(0, maxChars);
  const cut = Math.max(head.lastIndexOf(". "), head.lastIndexOf("\n"));
  return { text: cut > maxChars * 0.6 ? head.slice(0, cut + 1) : head, truncated: true };
}

/** Split a page into passages of a few sentences each, capped in count. */
export function splitPassages(text: string, opts: { targetChars?: number; maxPassages: number }): string[] {
  const target = opts.targetChars ?? 600;
  const sentences = splitSentences(text);
  const passages: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if (buf && buf.length + s.length + 1 > target) {
      passages.push(buf);
      buf = s;
    } else {
      buf = buf ? `${buf} ${s}` : s;
    }
  }
  if (buf) passages.push(buf);
  return passages.filter((p) => p.length >= 40).slice(0, opts.maxPassages);
}

/** Extract http(s) URLs from text. */
export function extractUrls(text: string): string[] {
  const re = /https?:\/\/[^\s<>"')\]]+/gi;
  const found = new Set<string>();
  for (const m of text.matchAll(re)) {
    found.add(m[0].replace(/[.,;:!?]+$/, ""));
  }
  return [...found];
}

/** True when the whole text is a single URL. */
export function isBareUrl(text: string): boolean {
  const t = text.trim();
  return /^https?:\/\/\S+$/i.test(t) && !/\s/.test(t);
}

export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length > 300) return false;
  if (t.endsWith("?")) return true;
  return /^(is|are|was|were|did|does|do|who|what|when|where|why|how|can|could|should|would|has|have)\b/i.test(t);
}

export function isVideoUrl(url: string): boolean {
  return /(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\/|vimeo\.com\/\d+)/i.test(url);
}
