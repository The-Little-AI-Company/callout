/**
 * Video by URL (PRD F4c): transcript first. YouTube publishes caption tracks
 * in the watch page's player response; the first track (preferring English)
 * is fetched as timed text and flattened. No transcript means the helper's
 * frame sampling would be next, which needs the video file and is not in this
 * build. The caller says so honestly.
 */
import type { FetchLike } from "./readable";

export interface Transcript {
  text: string;
  language: string;
  source: "youtube_captions";
  title?: string;
}

export async function fetchYouTubeTranscript(url: string, fetch: FetchLike): Promise<Transcript | { error: string }> {
  const id = youTubeId(url);
  if (!id) return { error: "Not a YouTube URL." };
  const res = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
    headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Callout/0.1", "accept-language": "en" },
  });
  if (!res.ok) return { error: `YouTube returned HTTP ${res.status}.` };
  const html = await res.text();
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/ - YouTube$/, "").trim();
  const m = html.match(/"captionTracks":(\[.*?\])/);
  if (!m?.[1]) return { error: "This video has no caption track." };
  let tracks: Array<{ baseUrl: string; languageCode: string; kind?: string }>;
  try {
    tracks = JSON.parse(m[1]) as typeof tracks;
  } catch {
    return { error: "Could not read the caption list." };
  }
  if (tracks.length === 0) return { error: "This video has no caption track." };
  const track = tracks.find((t) => t.languageCode.startsWith("en") && t.kind !== "asr") ?? tracks.find((t) => t.languageCode.startsWith("en")) ?? tracks[0]!;
  const tt = await fetch(track.baseUrl.replace(/\\u0026/g, "&"));
  if (!tt.ok) return { error: `Caption fetch returned HTTP ${tt.status}.` };
  const xml = await tt.text();
  const text = xml
    .replace(/<\/?text[^>]*>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");
  if (!text) return { error: "The caption track was empty." };
  return { text, language: track.languageCode, source: "youtube_captions", title };
}

export function youTubeId(url: string): string | undefined {
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  return m?.[1];
}
