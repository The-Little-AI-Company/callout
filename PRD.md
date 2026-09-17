# Callout: product requirements

Name: Callout (chosen 2026-09-17; formerly working title BS Detector).
Version: PRD v0.2, 2026-09-17.
Companion technical design: `PLAN.md` in this folder.
Standalone product. Unrelated to Vivary. Builder: Codex, own repository.

## 1. One-line

Press a hotkey over anything you are reading and get an honest, fast read on
whether it is trying to fool you and whether its claims hold up against real
sources, without the tool itself making things up.

## 2. Problem

Everyday readers meet persuasive text all day: posts, ads, news, product pages,
video captions. Checking a claim means opening tabs, searching, and reading,
so almost nobody does it. Existing "AI fact checkers" answer in confident prose
with no evidence trail and are themselves a source of fabrication. Readers need
something that is one keypress away, answers in under a second, shows its
sources, and says "unsure" when it is unsure.

## 3. Target user

Everyday readers on Windows desktop who read in a browser, chat apps, email,
and PDFs. Not researchers, moderators, or developers in v1. They do not know
what a classifier is and should never need to. They do configure their own API
keys once, with guided setup.

## 4. Decisions already made

| Decision | Choice |
|---|---|
| Audience | Everyday readers |
| Form factor | Desktop tray app with a global hotkey, Windows first, Mac later |
| Business | Free, bring your own keys (Typesafe, an LLM provider, a search API) |
| Scope v1 | Fast lane plus deep lane on selected text and URLs; video and OCR later |
| Verdict UX | Traffic light per claim with a one-line why; evidence behind a tap |
| License | Open source, MIT |
| Privacy | Local history off by default; text leaves the machine only to user-configured APIs |
| Search API | Tavily |
| Ownership | The Little AI Company |
| Distribution of build 1 | Private beta behind a signup form on a landing page. No public download until the section 9 gates pass |
| LLM helper default model | DeepSeek V4.1 Flash for vision and extraction; user-switchable in settings |
| LLM helper | Optional, user-enabled. Handles what Jev cannot: seeing screenshots, transcribing video, cleaning messy input, answering follow-up questions. Jev is text and JSON only, confirmed in the Typesafe docs on 2026-09-17 |

## 4a. Division of labor, restated for the helper

Jev cannot see. It judges text. So for anything that is not clean text, the LLM
helper converts first and Jev judges second:

| Input | Helper does | Jev does |
|---|---|---|
| Clean selected text | nothing | fast lane and deep lane |
| Messy paste (chat logs, forwarded emails, comment threads) | extracts the actual claims and who said them | judges the extracted claims |
| Screenshot | vision model reads the text and describes charts or images | judges the transcription, marked as transcribed |
| Video | transcript by URL when available, otherwise sampled frames plus audio through the helper | judges the transcript, marked as transcribed |
| A question typed by the user | answers only from evidence Jev has already judged | checks every sentence of the answer |

The user never prepares input. The helper does the prep so the user is not
overwhelmed, and everything the helper produces is labeled as helper output
and passed through Jev before it reaches the screen.

## 5. Core experience

1. The user highlights text anywhere, or copies a URL, and presses the hotkey.
2. A small popover appears near the cursor within 300 ms with the fast lane:
   what kind of text this is, and up to five plain-language signals such as
   "pushes urgency", "big numbers, no source", "contradicts itself". Header
   text reads "Signals in the text itself. Not a truth check."
3. If the text contains checkable claims, the deep lane starts (automatically
   when the fast lane says it is worth it, otherwise on a "Check claims"
   button). Claims appear as rows, each with a gray dot that turns green,
   amber, or red as evidence arrives, plus a one-line why.
4. Tapping a claim shows the quote from the original, the best source passage,
   and a link. Unsure rows say what was missing: no source found, source
   paywalled, evidence off-topic.
5. A two-sentence summary appears last, and only sentences the engine could tie
   to a shown source survive.
6. The popover has one small input box at the bottom. It does two jobs. Paste
   text that cannot be selected (an image caption, a locked PDF, a chat app
   that blocks copy) and press Enter to check it. Or type a question about what
   is on screen ("is the 40 percent figure real?", "who actually said this?")
   and the helper answers from the judged evidence only.
7. When the helper is off, the box only accepts text to check and says so.
8. Escape closes the popover. Nothing is stored unless history is on.

The window stays small. One column, five signals at most, claims as rows, the
input box, and a single expand control for evidence. No chat transcript view.
Follow-up answers replace the summary area rather than stacking.

Colors, fixed meaning:

- Green: at least one fetched source supports the claim at high confidence and
  none contradict.
- Red: a fetched source contradicts the claim at high confidence, or the claim
  quotes something that does not exist in the source it cites.
- Amber: sources found but support is weak or mixed.
- Gray: unsure or not checkable, with the reason.

## 6. Functional requirements

Capture

- F1. Global hotkey, user-configurable, works over any foreground app.
- F2. Selected text via simulated copy with clipboard restore; clipboard
  fallback when nothing is selected.
- F3. A URL on the clipboard or in the selection triggers page fetch and
  readable-text extraction.
- F4. Minimum and maximum input length with clear messages.
- F4a. Input box accepts pasted text and, when the helper is on, a natural
  language question. A pasted URL is treated as a page to fetch.
- F4b. Screenshot capture by region, sent to the helper's vision model for
  transcription when the helper is on; without the helper, screenshots are not
  supported and the app says so.
- F4c. Video by URL: transcript first, helper transcription as fallback.

Fast lane

- F5. One Typesafe call per press, all questions batched, target 100 ms model
  time and 300 ms end to end.
- F6. Content-kind gating: opinion, satire, fiction, and advertising hide the
  factual signals and say why.
- F7. At most five signals shown, ordered by probability, each with a fixed
  plain-language label and a one-line explanation written for readers.
- F8. A "worth a deep check" judgment decides whether the deep lane starts
  automatically.

Manipulation panel (part of the fast lane, same single Jev call)

- F8a. A separate "How it's trying to persuade you" section under the signals,
  showing up to four detected techniques with a plain-language label and a one
  line example from the text itself, quoted.
- F8b. Techniques are detected as independent yes/no judgments, one per
  technique, all in the same call. Families in v1:
  - Emotional pressure: fear appeal, urgency, scarcity, outrage bait, guilt.
  - Faulty reasoning: false dilemma, strawman, slippery slope, correlation
    presented as causation, cherry-picked example, whataboutism.
  - Authority and crowd: appeal to unnamed experts, bandwagon, fake social
    proof, "everyone knows".
  - Numbers games: relative risk without absolute, missing base rate, cropped
    time window, percent of an unknown total, precise-sounding made-up figures.
  - Framing: loaded language, euphemism, leading question, burying the
    counterpoint, motte-and-bailey.
  - Commercial and dark patterns: hidden cost, fake countdown, affiliate or
    sponsored intent not disclosed, testimonial without identity.
  - Source games: quote with no source, screenshot of a screenshot, "leaked"
    with no provenance, altered headline.
- F8c. An overall manipulation level in words: straightforward, persuasive but
  fair, leans on you, built to mislead. Shown as a single line, never a number.
- F8d. Manipulation signals show for every content kind, including opinion and
  ads, because persuasion technique is independent of truth. Only the factual
  signals are hidden for opinion and satire.
- F8e. Labels are written for readers and avoid jargon. "Makes you feel you
  must act now" rather than "urgency appeal". The jargon name appears only in
  the expanded view.
- F8f. Technique wording, examples, and thresholds live in the same open
  question file as everything else (F23).

Deep lane

- F9. LLM claim extraction returning atomic claims with exact quotes; any claim
  whose quote is not in the source text is discarded before display.
- F10. Typesafe judgment per claim: checkable or not, central or incidental.
  Only checkable and central claims are fetched for.
- F11. Evidence order: sources cited in the text first, then web search with
  LLM-written queries. Caps per claim on queries, pages, and passages.
- F12. Typesafe rerank of passages per claim, then a supports, contradicts, or
  says-nothing judgment per passage, rolled up in code.
- F13. LLM summary written only from kept passages, then checked sentence by
  sentence by Typesafe; unsupported sentences are removed and the summary is
  regenerated once.
- F14. Every verdict is stamped with the confidence threshold in force and the
  raw judgments, so thresholds can change without re-running inference.
- F14a. Web search uses Tavily with the user's own key. Results are fetched and
  passed through the same rerank and support judgment as cited sources.

LLM helper

- F14b. Helper is off until the user adds an LLM key and turns it on.
- F14c. Helper outputs are always labeled as helper output in state and never
  shown as verdicts. The helper extracts, transcribes, and explains; Jev judges.
- F14d. Follow-up answers are built only from passages Jev has judged for this
  check, and every answer sentence is checked by Jev before display. A sentence
  Jev cannot tie to evidence is replaced with "not in the evidence".
- F14e. The helper may trigger a new evidence search for a follow-up question,
  within the same caps as the deep lane.

Truthfulness confidence

- F14f. Each claim shows a confidence band in words: strong evidence, some
  evidence, or can't tell. Bands map to the roll-up in code, never to a raw
  number shown to the reader.
- F14g. The product promise is precision on green and red, not coverage: a
  green or red verdict must be right at least 90 percent of the time on the
  human-reviewed sample before public release (see section 9). Unsure is
  allowed to be common. Bluffing is not allowed at all.

Setup and settings

- F15. First-run wizard for three keys with links to get each, a test button
  per key, and a working mode with only the Typesafe key (fast lane only).
- F16. Keys stored in the OS credential store.
- F17. Settings: hotkey, auto deep check on or off, history on or off, per-check
  caps, model choice for the LLM steps.

History and cost

- F18. History off by default. When on, stores text, verdicts, sources, and
  usage locally with one-click clear.
- F19. Usage counter per API always on, shown in settings as calls and tokens,
  with an estimated cost field the user can fill in once prices are known.

Honesty and safety

- F20. No verdict without a shown source. No "false" label without a
  contradicting source or a fabricated quote.
- F21. Every unsure result names its reason.
- F22. The app never sends text anywhere except the three user-configured APIs
  and the pages it fetches, and says so on the settings page.
- F23. The question wording and thresholds live in one human-readable file in
  the open repository.

## 7. Non-functional requirements

- N1. Fast lane end to end under 300 ms at p50, under 800 ms at p95.
- N2. Deep lane first verdict within 4 s, complete within 15 s for five claims.
- N3. App memory footprint suitable for always-on tray use.
- N4. Works offline in a degraded mode that says it is offline.
- N5. Windows 10 and 11 first; Mac later; no Linux commitment in v1.
- N6. Accessible popover: keyboard navigation, screen-reader labels, color
  never the only signal (dots carry text labels).

## 8. Out of scope for v1

- Browser extension, mobile. (Screenshots and video are in scope through the
  helper; see F4b and F4c. They ship in milestone 4.)
- Any hosted service, accounts, or billing.
- Batch or team features, shared policies, moderation queues.
- Any integration with other products, including agent or coding tools.
- Auto-checking pages as they load.

## 9. Success measures

Measured locally and opt-in only, since there is no server.

| Measure | Target for the first 30 days with a small test group |
|---|---|
| Fast-lane latency p50 | under 300 ms |
| Deep checks per day per active user | 3 or more |
| Share of deep checks with at least one green or red | 60 percent or more |
| Share of verdicts a human reviewer disagrees with, on a 50-item sample | under 10 percent for green and red |
| Unsure share | reported, not targeted; it must stay honest |
| Cost per deep check | known number by day 7, from the usage counter |

## 10. Risks

- Typesafe pricing is unpublished and current access may be temporary. All
  Typesafe questions sit behind one interface so the fast lane can be replaced
  with a local model later; the deep-lane judging is the hard part to replace.
- Search API costs and terms vary; choice deferred to the technical plan.
- Over-trust: a colored dot reads as authority. Mitigated by mandatory sources,
  gray as a first-class state, and the fixed header on the fast lane.
- Paywalled and JavaScript-heavy pages defeat fetching; reported as unsure with
  reason, never guessed.
- Clipboard capture can misfire in some apps; clipboard fallback and a paste box
  in the popover cover it.

## 10a. Beta signup and landing page (build 1)

The only hosted piece in v1. Everything else stays local.

- L0. Hosting: the landing page, the signup handler, and beta downloads are
  hosted by the little ai company (Jeff's side). Ethan's side co-brands.
- L1. One landing page under the combined brand: what the tool does, the
  honesty promise from section 5, a short demo capture, and a signup form.
- L2. Form fields: email, operating system, what they mostly read (a few
  checkboxes), and consent to be contacted about the beta. Nothing else.
- L3. No separate signup database. The form posts to a tiny serverless
  handler that sends the signup through Resend: a confirmation to the tester
  and a copy to a shared partner inbox. Resend's audience or contacts list is
  the roster. Export from there when needed. No analytics beyond signup count.
- L3a. Hard cap of 20 testers for the first wave. Once 20 confirmed signups
  exist, the form switches to a waitlist message and still sends the
  confirmation so later waves can be invited from the same list.
- L4. Invites go out through Resend with a download link, a setup guide for
  the three keys, and a feedback link. Later waves are sized so the human
  review in section 9 can keep up.
- L5. The landing page states clearly that the app uses the tester's own API
  keys and that checked text never reaches the partners' servers.
- L6. Beta builds are signed and versioned; each tester sees the build number
  in settings so feedback can be matched to a build.
- L7. A feedback path inside the app: one button that copies a redacted report
  (verdicts and usage, no checked text unless the tester ticks a box) for
  pasting into the feedback form.

Both partners approve the landing page copy and the brand treatment before
anything is published.

## 10b. Assets

Art and icons are produced by the partners with ChatGPT's image generation,
not by the build agent. The build agent lists every needed asset with a spec
and a starting prompt in `docs/ASSETS.md` and ships placeholders until the art
lands. The v1 asset list and the mascot prompt are in `HANDOFF.md`.

## 10c. Personality and voice

Callout has a character. The honesty rules in section 6 do not bend for it.

Mascot

- A skullbunny: rabbit ears on a small skull, eyes drawn as two flat lines.
  It wears an "eat the rich" T-shirt. It carries a small green robot plushy in
  both arms, in the spirit of GIR from Invader Zim.
- The mascot lives on the landing page, the tray icon, the empty state of the
  popover, the settings page, and the error states. It does not appear next to
  verdicts.
- Design intent, decided: the plushy is meant to evoke GIR and make the user
  think of Invader Zim. Build it as a clear homage rather than a copy: an
  original green robot plushy with the same energy (round head, big eyes,
  slightly unhinged grin, dog-suit-style hood or ears), not GIR's exact design,
  name, or catchphrases. The reference should be obvious to fans and deniable
  on paper. Do not use the GIR name or Invader Zim marks anywhere in the
  product, site, or store listing.
- The "eat the rich" shirt stays. Both partners are comfortable with the tone.

Voice

- Dry, quick, a little edgy, never cruel to the reader. Jokes are aimed at the
  text being checked, at manipulation techniques, and at the mascot itself.
- Where jokes live: empty states, loading lines, the fast-lane header rotation,
  error messages, settings copy, release notes, landing page, and the beta
  emails.
- Where jokes never live: the verdict dot labels, the one-line why for each
  claim, the evidence view, the confidence bands, and the unsure reasons. Those
  are plain and literal, always. A reader must be able to tell the joke from
  the finding at a glance.
- A small line bank ships in the open repository, tagged by surface, so both
  partners can add lines without touching code. Lines are reviewed for not
  punching down and for not implying a verdict the engine did not produce.
- Example loading lines: "Sniffing for hogwash." "Reading the fine print so
  you don't have to." "Checking who actually said that." Example empty state:
  "Highlight something suspicious and hit the key. I'll bring the receipts."

Tone across the product must stay consistent with the section 5 header,
"Signals in the text itself. Not a truth check." The mascot is allowed to be
funny about being unsure; it is not allowed to be funny instead of being
unsure.

## 11. Open questions for the user

- Final brand name and spelling for the combined company, and whether the app
  keeps the BS Detector working title in the beta.
- Where the signup store lives (a form service, a small database, or a sheet)
  and who owns the domain.
(Resolved 2026-09-17: the helper's default vision model is DeepSeek V4.1
Flash. Users can switch models in settings.)

## 12. Milestones

1. Popover shell, hotkey, capture, settings wizard with key tests.
2. Fast lane live with usage counter; internal dogfood.
3. Claim extraction, evidence fetching, rerank and support judging; verdict UI.
4. Helper: input box questions, messy-paste extraction, screenshot and video
   transcription; summary plus summary check; history; offline mode;
   accessibility pass.
5. Landing page and signup form live under the combined brand; first invite
   wave; fifty-item human review of verdicts and a week of cost data from
   testers; go or no-go on a public release.
