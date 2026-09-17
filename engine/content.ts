/**
 * Loads and types the human-readable question file (content/questions.yaml)
 * and the line bank (content/lines.yaml). Code never inlines question wording.
 */
import { parse } from "yaml";
import type { ContentKind } from "./types";

export type { EntryType } from "@typesafe-ai/sdk";
import type { EntryType } from "@typesafe-ai/sdk";

export interface NoulSpec {
  instructions: EntryType;
  criteria?: { true?: EntryType; false?: EntryType };
}

export interface SignalSpec extends NoulSpec {
  id: string;
  label: string;
  why: string;
  invert?: boolean;
}

export interface TechniqueSpec extends NoulSpec {
  id: string;
  family: string;
  label: string;
  jargon: string;
}

export interface Thresholds {
  signal_show: number;
  signals_max_shown: number;
  technique_show: number;
  techniques_max_shown: number;
  example_pick_min: number;
  worth_deep_check_auto: number;
  content_kind_min_confidence: number;
  checkable_min: number;
  central_min: number;
  relevance_keep_top: number;
  relevance_min_score: number;
  support_confidence: number;
  explanation_confidence: number;
  max_claims: number;
  max_queries_per_claim: number;
  max_pages_per_claim: number;
  max_passages_per_page: number;
  max_search_results_per_query: number;
  min_text_chars: number;
  max_text_chars: number;
}

export interface QuestionContent {
  version: number;
  model: string;
  thresholds: Thresholds;
  fast_lane: {
    header: string;
    content_kind: {
      instructions: EntryType;
      criteria: Record<ContentKind, EntryType>;
      labels: Record<ContentKind, string>;
      hide_factual_for: ContentKind[];
      hide_reason: Partial<Record<ContentKind, string>>;
    };
    signals: SignalSpec[];
    worth_deep_check: { instructions: EntryType; criteria: Record<"yes" | "no" | "unsure", EntryType> };
    manipulation_level: { instructions: EntryType; criteria: EntryType[]; labels: string[] };
    techniques: TechniqueSpec[];
  };
  example_pick: { instructions: EntryType; none_label: string };
  deep_lane: {
    claim_checkable: NoulSpec;
    claim_central: NoulSpec;
    claim_quote_faithful: NoulSpec;
    passage_relevance: { instructions: EntryType; criteria: EntryType[] };
    relation: { instructions: EntryType; criteria: Record<"supports" | "contradicts" | "says_nothing", EntryType> };
    explanation_sentence_check: NoulSpec;
    answer_sentence_check: NoulSpec;
  };
  verdicts: {
    supported: { label: string; why: string };
    contradicted: { label: string; why: string };
    fabricated_quote: { label: string; why: string };
    mixed: { label: string; why: string };
    unsupported: { label: string; why: string };
    unsure: { label: string };
    not_checkable: { label: string; why: string };
    incidental: { label: string; why: string };
    confidence_bands: Record<"strong" | "some" | "none", string>;
    unsure_reasons: Record<string, string>;
  };
}

export type LineBank = Record<string, string[]>;

export function parseQuestionContent(yamlText: string): QuestionContent {
  const doc = parse(yamlText) as QuestionContent;
  validate(doc);
  return doc;
}

export function parseLineBank(yamlText: string): LineBank {
  return parse(yamlText) as LineBank;
}

function validate(doc: QuestionContent): void {
  const problems: string[] = [];
  if (!doc.thresholds) problems.push("thresholds missing");
  if (!doc.fast_lane?.signals?.length) problems.push("fast_lane.signals missing");
  if (!doc.fast_lane?.techniques?.length) problems.push("fast_lane.techniques missing");
  const ids = new Set<string>();
  for (const s of [...(doc.fast_lane?.signals ?? []), ...(doc.fast_lane?.techniques ?? [])]) {
    if (ids.has(s.id)) problems.push(`duplicate question id ${s.id}`);
    ids.add(s.id);
    if (!s.label) problems.push(`${s.id} has no label`);
  }
  const levels = doc.fast_lane?.manipulation_level?.criteria?.length ?? 0;
  if (levels !== doc.fast_lane?.manipulation_level?.labels?.length) {
    problems.push("manipulation_level labels do not match criteria count");
  }
  if (problems.length) throw new Error(`content/questions.yaml invalid: ${problems.join("; ")}`);
}

/** Pick a line for a surface. Deterministic when `seed` is given (tests). */
export function pickLine(bank: LineBank, surface: string, seed?: number): string {
  const lines = bank[surface];
  if (!lines || lines.length === 0) return "";
  const i = seed === undefined ? Math.floor(Math.random() * lines.length) : Math.abs(seed) % lines.length;
  return lines[i] ?? "";
}
