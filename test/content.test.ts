import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseQuestionContent, parseLineBank, pickLine } from "@engine/content";
import { buildFastLaneQuestions } from "@engine/fastlane";

const questions = parseQuestionContent(readFileSync("content/questions.yaml", "utf8"));
const lines = parseLineBank(readFileSync("content/lines.yaml", "utf8"));

describe("content/questions.yaml", () => {
  it("parses and validates", () => {
    expect(questions.version).toBe(1);
    expect(questions.model).toBe("jev-latest");
    expect(questions.fast_lane.signals.length).toBeGreaterThanOrEqual(6);
    expect(questions.fast_lane.techniques.length).toBeGreaterThanOrEqual(30);
  });

  it("covers every family from PRD F8b", () => {
    const families = new Set(questions.fast_lane.techniques.map((t) => t.family));
    expect([...families].sort()).toEqual(
      ["authority_and_crowd", "commercial_and_dark_patterns", "emotional_pressure", "faulty_reasoning", "framing", "numbers_games", "source_games"].sort(),
    );
  });

  it("has the fixed honest header", () => {
    expect(questions.fast_lane.header).toBe("Signals in the text itself. Not a truth check.");
  });

  it("builds one batched fast-lane request with every question", () => {
    const q = buildFastLaneQuestions(questions);
    const n = Object.keys(q).length;
    expect(n).toBe(3 + questions.fast_lane.signals.length + questions.fast_lane.techniques.length);
    for (const [, v] of Object.entries(q)) expect(["noul", "choice", "score"]).toContain(v.type);
  });

  it("keeps verdict copy literal: no exclamation marks, no mascot", () => {
    const v = JSON.stringify(questions.verdicts).toLowerCase();
    expect(v).not.toMatch(/plushy|skull|bunny|!/);
  });
});

describe("content/lines.yaml", () => {
  it("has lines for the surfaces the app uses", () => {
    for (const s of ["empty", "loading_fast", "loading_deep", "error_network", "error_key", "offline", "all_unsure", "waitlist"]) {
      expect(lines[s]?.length, s).toBeGreaterThan(0);
    }
  });

  it("no line implies a verdict", () => {
    for (const [surface, arr] of Object.entries(lines)) {
      for (const line of arr) {
        expect(line.toLowerCase(), `${surface}: ${line}`).not.toMatch(/\b(fake|false|true|lie|lying|debunked|confirmed)\b/);
      }
    }
  });

  it("pickLine is deterministic with a seed", () => {
    expect(pickLine(lines, "empty", 3)).toBe(pickLine(lines, "empty", 3));
    expect(pickLine(lines, "nope")).toBe("");
  });
});
