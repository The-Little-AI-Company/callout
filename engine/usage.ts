/**
 * Usage log. Every API call records tokens, lane, and step (PLAN section 5,
 * PRD F19). Counters are always on. Persistence is injected so the engine
 * stays free of Tauri.
 */
import type { ApiName, UsageEntry, UsageTotals } from "./types";

export interface UsageSink {
  append(entry: UsageEntry): void | Promise<void>;
}

export class UsageLog {
  private entries: UsageEntry[] = [];
  private sink?: UsageSink;

  constructor(sink?: UsageSink, initial: UsageEntry[] = []) {
    this.sink = sink;
    this.entries = [...initial];
  }

  record(entry: Omit<UsageEntry, "at">): UsageEntry {
    const full: UsageEntry = { ...entry, at: Date.now() };
    this.entries.push(full);
    void this.sink?.append(full);
    return full;
  }

  all(): readonly UsageEntry[] {
    return this.entries;
  }

  totals(api?: ApiName): UsageTotals {
    const rows = api ? this.entries.filter((e) => e.api === api) : this.entries;
    return rows.reduce(
      (t, e) => ({
        calls: t.calls + 1,
        inputTokens: t.inputTokens + e.inputTokens,
        outputTokens: t.outputTokens + e.outputTokens,
      }),
      { calls: 0, inputTokens: 0, outputTokens: 0 },
    );
  }

  /** Per-check cost table rows: lane and step with totals. Feeds docs/COSTS.md after step 3. */
  byLaneAndStep(): Array<{ lane: string; step: string; api: ApiName } & UsageTotals & { avgMs: number }> {
    const groups = new Map<string, UsageEntry[]>();
    for (const e of this.entries) {
      const k = `${e.api}|${e.lane}|${e.step}`;
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    return [...groups.entries()].map(([k, rows]) => {
      const [api, lane, step] = k.split("|") as [ApiName, string, string];
      const t = rows.reduce(
        (a, e) => ({
          calls: a.calls + 1,
          inputTokens: a.inputTokens + e.inputTokens,
          outputTokens: a.outputTokens + e.outputTokens,
          ms: a.ms + e.ms,
        }),
        { calls: 0, inputTokens: 0, outputTokens: 0, ms: 0 },
      );
      return { api, lane, step, calls: t.calls, inputTokens: t.inputTokens, outputTokens: t.outputTokens, avgMs: t.calls ? Math.round(t.ms / t.calls) : 0 };
    });
  }

  clear(): void {
    this.entries = [];
  }
}
