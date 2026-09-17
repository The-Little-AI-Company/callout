/**
 * Shared engine types. The engine is pure TypeScript with no Tauri or DOM
 * dependency so it runs in the webview, in Node tests, and in the eval script.
 */

export type SourceKind =
  | "selection"
  | "clipboard"
  | "page"
  | "paste"
  | "screenshot"
  | "video"
  | "question";

export interface CaptureSource {
  kind: SourceKind;
  url?: string;
  title?: string;
  /** True when the text was produced by the LLM helper (OCR, transcription, clean-up). */
  helperOutput: boolean;
}

export interface Capture {
  text: string;
  source: CaptureSource;
  capturedAt: number;
}

// ---------------------------------------------------------------------------
// Fast lane
// ---------------------------------------------------------------------------

export type ContentKind =
  | "factual_claim"
  | "opinion"
  | "prediction"
  | "advertisement"
  | "satire_or_fiction"
  | "mixed"
  | "none_of_these";

export interface Signal {
  id: string;
  label: string;
  why: string;
  probability: number;
}

export interface Technique {
  id: string;
  family: string;
  label: string;
  jargon: string;
  probability: number;
  /** Quoted sentence from the text, chosen by Jev in the example call. Absent when none stood out. */
  example?: string;
}

export interface FastLaneResult {
  header: string;
  contentKind: ContentKind;
  contentKindLabel: string;
  contentKindConfidence: number;
  /** Set when factual signals are hidden because of the content kind. */
  factualHiddenReason?: string;
  signals: Signal[];
  techniques: Technique[];
  manipulationLevel: { index: number; label: string; score: number; confidence: number };
  worthDeepCheck: { choice: "yes" | "no" | "unsure"; probabilities: Record<string, number> };
  autoDeepCheck: boolean;
  /** Raw answers, kept so thresholds can change without re-running (PRD F14). */
  raw: Record<string, unknown>;
  timing: { jevMs: number; exampleMs: number; totalMs: number };
}

// ---------------------------------------------------------------------------
// Deep lane
// ---------------------------------------------------------------------------

export type Verdict =
  | "supported"
  | "contradicted"
  | "fabricated_quote"
  | "mixed"
  | "unsupported"
  | "unsure"
  | "not_checkable"
  | "incidental";

export type ConfidenceBand = "strong" | "some" | "none";

export interface ExtractedClaim {
  id: string;
  text: string;
  /** Exact substring of the source text this claim came from. */
  quote: string;
  /** URL the text itself cites for this claim, when the helper found one. */
  citedUrl?: string;
  /** Text the claim attributes to a source, when the claim is "X said Y". */
  attributedQuote?: string;
}

export interface Passage {
  id: string;
  url: string;
  title?: string;
  text: string;
  index: number;
}

export interface PassageJudgment {
  passage: Passage;
  relevance: number;
  relation: "supports" | "contradicts" | "says_nothing";
  probabilities: Record<string, number>;
  confidence: number;
}

export interface ClaimVerdict {
  claim: ExtractedClaim;
  checkable: number;
  central: number;
  verdict: Verdict;
  verdictLabel: string;
  why: string;
  band: ConfidenceBand;
  bandLabel: string;
  unsureReason?: string;
  /** Best passage supporting the verdict, always present for green and red (PRD F20). */
  best?: PassageJudgment;
  judgments: PassageJudgment[];
  /** Threshold in force when the verdict was computed (PRD F14). */
  thresholds: { support_confidence: number };
}

export interface FetchedPage {
  url: string;
  finalUrl?: string;
  title?: string;
  text: string;
  status: "ok" | "paywalled" | "failed" | "empty";
  error?: string;
}

export interface Explanation {
  sentences: { text: string; backed: boolean }[];
  warning?: string;
}

export interface DeepLaneResult {
  claims: ClaimVerdict[];
  counts: Record<Verdict, number>;
  explanation?: Explanation;
  pagesFetched: FetchedPage[];
  timing: { firstVerdictMs?: number; totalMs: number };
}

export type DeepLaneEvent =
  | { type: "claims"; claims: ClaimVerdict[] }
  | { type: "claim"; claim: ClaimVerdict }
  | { type: "status"; message: string }
  | { type: "explanation"; explanation: Explanation }
  | { type: "done"; result: DeepLaneResult }
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// Usage (PRD F19, PLAN 5)
// ---------------------------------------------------------------------------

export type ApiName = "typesafe" | "llm" | "tavily" | "fetch";

export interface UsageEntry {
  api: ApiName;
  lane: "fast" | "deep" | "helper" | "test";
  step: string;
  inputTokens: number;
  outputTokens: number;
  ms: number;
  at: number;
  model?: string;
}

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}
