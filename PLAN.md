# Callout: hotkey claim checker, Jev alone and Jev plus an LLM

Status: planning document, 2026-09-17. This is a standalone product. It is not a
Vivary feature and does not live in any Vivary repository. Codex builds it in
its own project.

## 1. What it is

A small desktop app bound to a global hotkey. The user highlights text, a page,
a video, or a screenshot, presses the key, and a popover answers two questions:

1. Fast lane (Jev only, about 100 ms): what does this text's own shape say?
   Pressure, certainty without support, contradiction, missing sources, opinion
   dressed as fact. Jev has no world knowledge, so this lane never claims truth.
   It labels smells.
2. Deep lane (Jev plus an LLM, seconds): are the specific claims supported by
   evidence that can actually be fetched? Per claim: supported, contradicted,
   unsupported, or unsure, with links.

The popover shows the fast lane instantly and fills in the deep lane as it
arrives. "Unsure" is a first-class result, not a failure.

Division of labor, fixed for the whole design:

- Code owns the flow, caching, budgets, and every threshold.
- The LLM generates: claim extraction, search queries, and the final two-sentence
  explanation.
- Jev judges: claim type, smell signals, passage relevance, claim-versus-evidence
  support, and a final check of the LLM's own explanation against the evidence.

That last point matters. The LLM never gets to be the judge of anything,
including its own summary. Jev checks the LLM checking the text.

## 2. Capture modes

| Source | How | Notes |
|---|---|---|
| Selected text | simulate copy, read clipboard, restore clipboard | default path; works in every app |
| Clipboard | read as-is | fallback when nothing is selected |
| Browser page | URL from the active tab plus readable text | first version: user copies the URL; later a thin browser extension |
| Video | YouTube transcript by URL; otherwise sampled frames plus audio through the LLM helper | Jev is text and JSON only (confirmed in the Typesafe docs 2026-09-17), so the helper transcribes and Jev judges the transcript, marked as transcribed |
| Screenshot region | region select, then the LLM helper's vision model | no helper means no screenshot support; transcription is marked as helper output in state |
| Input box | paste text, a URL, or a question | questions go to the helper and are answered only from Jev-judged evidence, then checked by Jev sentence by sentence |

Search API: Tavily, user's own key.

Windows first. Build as a tray app with a global shortcut. Pick the lightest
shell that gives a global hotkey, clipboard access, and a popover; Electron or
Tauri both work. Mac later.

## 3. Fast lane: Jev only

One call. State is the captured text plus source metadata
(`{ text, source: { kind, url?, title?, ocr: bool } }`). All questions batched.

| id | type | intent |
|---|---|---|
| content_kind | choice | verifiable factual claim, opinion, prediction, advertisement or promotion, satire or fiction, mixed, none of these |
| pressure | noul | urgency, scarcity, fear, or "act now" framing |
| certainty_unsupported | noul | strong certainty with no source, data, or reasoning given |
| numbers_unsourced | noul | statistics or figures presented without any origin |
| contradiction | noul | the text contradicts itself |
| cites_sources | noul | names a checkable source, study, document, or person |
| ad_hominem_or_tribal | noul | attacks people or groups instead of addressing claims |
| manipulative_severity | score | 0 plain informational, 1 persuasive but fair, 2 leans on emotion or omission, 3 designed to mislead |
| worth_deep_check | choice | yes, no (nothing checkable), unsure |

Manipulation battery, same call, one Noul per technique (multi-label), each with
structured criteria (`what`, `not_for`, `examples`) and an instruction to quote
the shortest span of `text` that shows it. Families and initial techniques:

| family | nouls |
|---|---|
| emotional pressure | fear_appeal, urgency, scarcity, outrage_bait, guilt |
| faulty reasoning | false_dilemma, strawman, slippery_slope, correlation_as_causation, cherry_pick, whataboutism |
| authority and crowd | unnamed_experts, bandwagon, fake_social_proof |
| numbers games | relative_without_absolute, missing_base_rate, cropped_window, percent_of_unknown, suspicious_precision |
| framing | loaded_language, euphemism, leading_question, buried_counterpoint, motte_and_bailey |
| commercial and dark patterns | hidden_cost, fake_countdown, undisclosed_sponsorship, anonymous_testimonial |
| source games | unsourced_quote, screenshot_of_screenshot, leak_without_provenance, altered_headline |

Plus `manipulation_level` as a Score with four concrete levels (straightforward,
persuasive but fair, leans on you, built to mislead). About thirty Nouls in one
call is within the documented pattern (the parallel-questions cookbook batches
thirteen; the line-by-line cookbook scores 218 items). Measure latency and tokens
with the full battery before trimming.

Since Jev returns probabilities and not spans, the quoted example for each
detected technique comes from code: split `text` into sentences, and for the top
four techniques ask a second small call with one Choice per technique over the
sentence list ("which sentence best shows this?", with a none option). Only
runs for techniques above the display threshold, so it is usually one extra
call or none.

Code gates the panel on `content_kind` first: an opinion or satire result hides
the factual smells and says why. `worth_deep_check` decides whether the deep lane
starts automatically or waits for a click, which also saves LLM cost.

Fast lane copy must be honest: "Signals in the text itself. Not a truth check."

## 4. Deep lane: Jev plus an LLM

Pipeline, all steps owned by code:

1. Extract claims. LLM reads the text and returns a JSON list of atomic,
   checkable claims with the exact quote each came from. Code drops any claim
   whose quote is not a substring of the text (same prefilter as the citation
   check cookbook). Jev then asks per claim: is this actually checkable, and is
   it central to the text or incidental. Incidental and uncheckable claims are
   shown but not fetched.
2. Gather evidence. Two sources, in order:
   - Cited sources in the text or page (links, named documents). Fetch them.
   - Web search for the top claims. LLM writes two or three queries per claim;
     code runs them; fetch the top results. Cap pages per claim.
   Paywalled or unfetchable sources are reported as such, never guessed.
3. Rerank passages with Jev. Split each fetched page into passages, score every
   passage for relevance to its claim in one call per claim (the rerank and
   line-by-line cookbooks do hundreds of items per request). Keep the top few.
4. Judge support with Jev. Per claim and passage, one Choice: supports,
   contradicts, says nothing. Roll up per claim in code: any high-confidence
   contradiction wins; otherwise the strongest support; otherwise unsupported.
   Confidence below the threshold (start at 0.8 per the cookbook) shows as unsure.
5. Explain with the LLM. The LLM sees only the claims, the verdicts, and the
   passages Jev kept, and writes two sentences plus links. It is told it may not
   introduce facts that are not in those passages.
6. Check the explanation with Jev. Sentences of the explanation go back through
   the same supports/contradicts/says-nothing Choice against the kept passages.
   Any sentence that is not supported is removed and the explanation is
   regenerated once, then shown with a warning if it still fails.

Output per claim: verdict, confidence, the best passage, its link, and the quote
from the original text. Whole-text summary: counts of supported, contradicted,
unsupported, unsure, plus the fast-lane smells.

Model choice for the LLM helper: default is DeepSeek V4.1 Flash for vision,
transcription, claim extraction, and queries. The explanation step may use the
same model or a stronger one the user selects in settings. Keep the helper
behind one provider-agnostic interface so any OpenAI-compatible or Anthropic
endpoint works. Confirm the exact model ID, image input support, and pricing
from DeepSeek's live docs when the test project starts; do not hardcode from
memory.

## 5. Cost and the temporary free Jev access

Jev pricing is not published, and free beta access may end. Design for that:

- Log `usage.input_tokens` and `usage.output_tokens` for every Jev call with the
  lane and step, so the first week of use produces a real per-check cost table.
- The fast lane is one small call per hotkey press. It stays cheap regardless.
- The deep lane's cost is dominated by the LLM and by fetching, not by Jev.
  Caps: claims per check, pages per claim, passages per page. Cache by URL and by
  claim text.
- Keep every Jev question behind one interface so the fast-lane battery can be
  swapped for a local classifier later if Jev becomes unaffordable. The deep-lane
  judging (relevance and support) is where Jev is hardest to replace, so budget
  for that first.
- Never run the deep lane silently on every press; `worth_deep_check` or a click
  starts it.

## 6. Where it lives

Its own repository and its own product. Standalone tray app, own settings file,
keys in the OS keychain or an environment variable, history stored locally.
Nothing is sent anywhere except Typesafe, the LLM provider, the search API, and
the pages being fetched. Explicit opt-in for every network-backed feature and a
visible per-check cost readout.

## 7. Build order

1. Capture: hotkey, selection and clipboard, URL and readable text, popover shell.
2. Fast lane end to end with usage logging. Acceptance: under 300 ms from key
   press to panel on selected text; honest copy; gating on content kind.
3. Claim extraction and the substring prefilter. Acceptance: no claim shown
   whose quote is not in the source text.
4. Evidence gathering with caps and caching, cited sources before search.
5. Jev rerank and support judging. Acceptance: per-claim verdicts with links on a
   fixed set of 20 sample texts, including planted false and unsupported claims,
   reviewed by a human.
6. LLM explanation plus the Jev check of the explanation. Acceptance: no
   explanation sentence survives that Jev cannot tie to a kept passage.
7. Video transcripts and screenshot OCR.
8. Usage report after a week of real use: cost per fast check, cost per deep
   check, and how often "unsure" appears. Decide on Jev dependence from that.

## 8. Open questions

- Typesafe pricing and whether beta access is metered. Ask on the beta account.
- Search API choice for the deep lane (needs a key and its own cost).
- Whether to ship a browser extension early for clean page capture, or rely on
  copy and clipboard for the whole test phase.
- How much of the fast lane survives if Jev goes away, which the week-one usage
  report should answer.
