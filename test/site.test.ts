import { describe, it, expect } from "vitest";
import { validate } from "../site/api/signup";

describe("signup validation (PRD L2)", () => {
  it("accepts a complete signup and normalizes the email", () => {
    const r = validate({ email: " Tester@Example.com ", os: "windows", reads: ["news", "bogus"], consent: true });
    expect(r).toEqual({ email: "tester@example.com", os: "windows", reads: ["news"], consent: true });
  });
  it("rejects missing consent, bad email, and unknown os", () => {
    expect(validate({ email: "a@b.co", os: "windows", consent: false })).toHaveProperty("error");
    expect(validate({ email: "nope", os: "windows", consent: true })).toHaveProperty("error");
    expect(validate({ email: "a@b.co", os: "beos", consent: true })).toHaveProperty("error");
  });
});
