import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseQuestionContent } from "@engine/content";
import { runFastLane } from "@engine/fastlane";
import { MockJev } from "@engine/jev/mock";
import { UsageLog } from "@engine/usage";
import type { Capture } from "@engine/types";

const content = parseQuestionContent(readFileSync("content/questions.yaml", "utf8"));

const capture = (text: string): Capture => ({ text, source: { kind: "selection", helperOutput: false }, capturedAt: Date.now() });

const AD = "Only 3 left! Doctors agree this is the best supplement. Order in the next 10 minutes or miss out forever. Rated 5 stars by 10,000 happy customers.";

describe("fast lane", () => {
  it("shows at most five signals, four techniques, and the honest header", async () => {
    const jev = new MockJev((id, q) => {
      if (id === "content_kind") return "factual_claim";
      if (id === "worth_deep_check") return "yes";
      if (id === "manipulation_level") return 2;
      if (id.startsWith("signal:")) return 0.9;
      if (id.startsWith("technique:")) return 0.8;
      if (q.type === "choice") return "1"; // example pick
      return 0;
    });
    const r = await runFastLane(jev, content, capture(AD));
    expect(r.header).toBe("Signals in the text itself. Not a truth check.");
    expect(r.signals.length).toBeLessThanOrEqual(5);
    expect(r.techniques.length).toBe(4);
    expect(r.manipulationLevel.label).toBe("Leans on you");
    expect(r.autoDeepCheck).toBe(true);
    expect(r.techniques.every((t) => t.example === "Only 3 left!")).toBe(true);
    expect(jev.calls.length).toBe(2); // battery + examples
    expect(jev.calls[0]!.meta).toMatchObject({ lane: "fast", step: "battery" });
  });

  it("hides factual signals for opinion but keeps manipulation techniques (F6, F8d)", async () => {
    const jev = new MockJev((id) => {
      if (id === "content_kind") return "opinion";
      if (id === "worth_deep_check") return "yes";
      if (id.startsWith("signal:")) return 0.95;
      if (id === "technique:loaded_language") return 0.9;
      return 0.1;
    });
    const r = await runFastLane(jev, content, capture("This is the worst phone ever made by this pathetic regime of a company."), { skipExamples: true });
    expect(r.signals).toEqual([]);
    expect(r.factualHiddenReason).toMatch(/opinion/);
    expect(r.techniques.map((t) => t.id)).toEqual(["loaded_language"]);
    expect(r.autoDeepCheck).toBe(false);
  });

  it("inverts the cites_sources signal into 'names no checkable source'", async () => {
    const jev = new MockJev((id) => {
      if (id === "content_kind") return "factual_claim";
      if (id === "worth_deep_check") return "no";
      if (id === "signal:cites_sources") return 0.1;
      return 0.1;
    });
    const r = await runFastLane(jev, content, capture("Crime is up 300 percent this year."), { skipExamples: true });
    expect(r.signals.map((s) => s.id)).toEqual(["cites_sources"]);
    expect(r.signals[0]!.label).toBe("Names no checkable source");
    expect(r.autoDeepCheck).toBe(false);
  });

  it("logs usage with lane and step", async () => {
    const usage = new UsageLog();
    const jev = new MockJev(() => 0.1, usage);
    await runFastLane(jev, content, capture("Plain text."), { skipExamples: true });
    const t = usage.totals("typesafe");
    expect(t.calls).toBe(1);
    expect(usage.byLaneAndStep()[0]).toMatchObject({ lane: "fast", step: "battery" });
  });

  it("falls back to mixed when the content kind is not confident", async () => {
    const jev = new MockJev((id) => (id === "content_kind" ? "opinion" : 0.1));
    // MockJev always answers choice with 0.9 confidence; exercise the threshold by lowering it in a copy.
    const c = structuredClone(content);
    c.thresholds.content_kind_min_confidence = 0.95;
    const r = await runFastLane(jev, c, capture("Whatever."), { skipExamples: true });
    expect(r.contentKind).toBe("mixed");
  });
});
