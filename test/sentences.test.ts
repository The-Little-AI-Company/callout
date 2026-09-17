import { describe, it, expect } from "vitest";
import { splitSentences, normalize, containsQuote, splitPassages, extractUrls, isBareUrl, looksLikeQuestion, truncate } from "@engine/text/sentences";

describe("splitSentences", () => {
  it("splits on terminal punctuation and keeps abbreviations together", () => {
    const s = splitSentences("Dr. Smith said no. The U.S. team won! Really? Yes.");
    expect(s).toEqual(["Dr. Smith said no.", "The U.S. team won!", "Really?", "Yes."]);
  });
  it("treats line breaks as boundaries", () => {
    expect(splitSentences("One line\nAnother line")).toEqual(["One line", "Another line"]);
  });
});

describe("normalize and containsQuote", () => {
  it("matches across curly quotes and line wraps", () => {
    const src = "He said “we never\n  promised that” on Tuesday.";
    expect(containsQuote(src, 'we never promised that')).toBe(true);
    expect(containsQuote(src, "we always promised")).toBe(false);
    expect(normalize("a — b")).toBe("a - b");
  });
});

describe("passages and urls", () => {
  it("splits long text into capped passages", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} says something moderately long about a topic.`).join(" ");
    const p = splitPassages(text, { targetChars: 300, maxPassages: 5 });
    expect(p.length).toBe(5);
    for (const x of p) expect(x.length).toBeLessThanOrEqual(400);
  });
  it("extracts urls and strips trailing punctuation", () => {
    expect(extractUrls("see https://example.com/a. and (https://b.org/x)")).toEqual(["https://example.com/a", "https://b.org/x"]);
    expect(isBareUrl(" https://x.y/z ")).toBe(true);
    expect(isBareUrl("go to https://x.y/z now")).toBe(false);
  });
  it("detects questions", () => {
    expect(looksLikeQuestion("is the 40 percent figure real?")).toBe(true);
    expect(looksLikeQuestion("Who actually said this")).toBe(true);
    expect(looksLikeQuestion("The figure is 40 percent.")).toBe(false);
  });
  it("truncates at a sentence boundary", () => {
    const r = truncate("First sentence here. Second sentence here. Third one.", 30);
    expect(r.truncated).toBe(true);
    expect(r.text).toBe("First sentence here.");
  });
});
