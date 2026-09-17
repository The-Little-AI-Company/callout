/**
 * Local history (PRD F18). Off by default. When on, stores text, verdicts,
 * sources, and usage locally. One-click clear.
 */
import { kv } from "./tauri";
import type { FastLaneResult, DeepLaneResult, CaptureSource } from "@engine/types";

export interface HistoryEntry {
  at: number;
  text: string;
  source: CaptureSource;
  fast: { contentKind: string; signals: string[]; techniques: string[]; level: string };
  deep?: { counts: DeepLaneResult["counts"]; claims: Array<{ text: string; verdict: string; url?: string }> };
}

const KEY = "history";
const MAX = 200;

export async function appendHistory(text: string, source: CaptureSource, fast: FastLaneResult, deep?: DeepLaneResult): Promise<void> {
  const store = await kv();
  const list = (await store.get<HistoryEntry[]>(KEY)) ?? [];
  list.push({
    at: Date.now(),
    text,
    source,
    fast: { contentKind: fast.contentKind, signals: fast.signals.map((s) => s.id), techniques: fast.techniques.map((t) => t.id), level: fast.manipulationLevel.label },
    deep: deep ? { counts: deep.counts, claims: deep.claims.map((c) => ({ text: c.claim.text, verdict: c.verdict, url: c.best?.passage.url })) } : undefined,
  });
  await store.set(KEY, list.slice(-MAX));
}

export async function readHistory(): Promise<HistoryEntry[]> {
  return (await (await kv()).get<HistoryEntry[]>(KEY)) ?? [];
}

export async function clearHistory(): Promise<void> {
  await (await kv()).set(KEY, []);
}
