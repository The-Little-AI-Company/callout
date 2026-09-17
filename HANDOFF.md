# Callout: handoff prompt for a fresh build session

Copy everything below the line into a new Codex session started in an empty
folder for the Callout repository. Keep `PRD.md` and `PLAN.md` from this folder
next to it, or copy them into the new repo under `docs/`.

---

You are building Callout, a Windows tray app on a global hotkey that tells an
everyday reader whether the text they are looking at is trying to manipulate
them and whether its claims hold up against real sources. It is a standalone
open-source product (MIT) from the little ai company and Wazoo. It is unrelated
to any other project on this machine; do not read or touch other repositories.

Read first, in this order, before writing any code:

1. `docs/PRD.md`: product requirements. Sections 4, 5, 6, 10a, and 10b are
   binding. The honesty rules (F20 to F23) and the "jokes never live in
   verdict copy" rule override anything else.
2. `docs/PLAN.md`: technical design. Fast lane, manipulation battery, deep
   lane pipeline, capture modes, cost logging, and build order.
3. The TypeSafe skill. Install it with
   `npx skills add typesafe-ai/skills --skill typesafe-ai` and read
   https://docs.typesafe.ai/llms.txt. The live docs are the source of truth
   for the Jev API. Append `.md` to any docs path to get Markdown.

Fixed decisions. Do not reopen them:

- Engine split: code owns flow and thresholds; Jev (Typesafe `jev-latest`)
  judges; the LLM helper only extracts, transcribes, writes queries, and
  explains, and every helper sentence shown to the user is checked by Jev.
  Jev is text and JSON only.
- Keys: bring your own. Typesafe, Tavily, and an LLM provider. Stored in the
  Windows credential store. Fast lane works with only the Typesafe key.
- LLM helper default model: DeepSeek V4.1 Flash, behind a provider-agnostic
  interface (OpenAI-compatible and Anthropic endpoints both work). Confirm the
  exact model ID, image input support, and pricing from DeepSeek's live docs.
- UX: one small popover, one column, at most five signals, a manipulation
  section with at most four techniques and quoted examples, claims as
  traffic-light rows with a one-line why, evidence behind a tap, one input box
  at the bottom for pasted text or a question, no chat transcript.
- Colors: green needs a supporting source and no contradiction; red needs a
  contradicting source or a fabricated quote; amber is weak or mixed; gray is
  unsure with a stated reason. Confidence shown in words, never numbers.
- Privacy: history off by default; text goes only to the three configured
  APIs and fetched pages; usage counters per API always on.
- Beta: landing page plus signup form hosted by the little ai company;
  signups through Resend to a shared inbox and Resend contacts; hard cap of
  20 testers in wave one, then a waitlist message.
- Personality: skullbunny mascot with line eyes, "eat the rich" shirt, and a
  green robot plushy that is an obvious Invader Zim GIR homage without using
  GIR's exact design, name, or marks. Jokes live in empty states, loading
  lines, errors, settings, emails, and the site. Never in verdicts.

Stack guidance (choose, then record the choice in `docs/DECISIONS.md`):

- Shell: Tauri or Electron. Pick whichever gives a reliable global hotkey,
  clipboard read and restore, region screenshot, and a frameless popover on
  Windows 10 and 11 with the least weight. Mac later; do not block on it.
- Language: TypeScript throughout. `@typesafe-ai/sdk` for Jev. Tavily's
  official SDK for search. One thin adapter for the LLM helper.
- Landing page and signup handler: a small static site plus one serverless
  function that calls Resend. Keep it in the same repo under `site/`.
- All Jev question wording, criteria, thresholds, and the joke line bank live
  in human-readable files under `content/`, never inline in code.

Build order (from PLAN.md section 7, with acceptance):

1. Popover shell, hotkey, selection and clipboard capture, settings wizard
   with a test button per key. Acceptance: hotkey works over a browser, a chat
   app, and a PDF viewer; wizard rejects a bad key with a clear message.
2. Fast lane with the full manipulation battery and usage logging.
   Acceptance: under 300 ms end to end at p50 on selected text; content-kind
   gating works; header reads "Signals in the text itself. Not a truth check."
3. Deep lane: claim extraction with the substring prefilter, evidence from
   cited sources then Tavily, Jev rerank and support judgment, verdict rows.
   Acceptance: on a fixed set of 20 sample texts with planted false and
   unsupported claims, verdicts and links are reviewed by a human and green
   and red are right at least 90 percent of the time.
4. Helper features: input-box questions, messy-paste extraction, screenshot
   region to vision model, video by URL with transcript first; summary plus
   Jev check of the summary; history; offline mode; accessibility pass.
   Acceptance: no explanation sentence survives that Jev cannot tie to a kept
   passage; screenshots without the helper show the unsupported message.
5. Landing page, Resend signup with the 20 cap, signed and versioned build,
   in-app redacted feedback report. Acceptance: signup 21 gets the waitlist
   message and still receives a confirmation.

Working rules:

- Work in small pull requests, one build-order step or less each.
- Every Jev call logs `usage.input_tokens` and `usage.output_tokens` with the
  lane and step. Produce a cost table after step 3 from real usage.
- Never show a verdict without a shown source. Never invent a source.
- Do not add analytics, accounts, telemetry, or a server beyond the signup
  handler.
- Stop and ask before any external action: publishing, buying a domain,
  sending real emails, or creating accounts.

Assets. Do not generate images yourself. The partners produce art with
ChatGPT's image generation. When you need an asset, add a row to
`docs/ASSETS.md` with the filename, size, format, where it is used, and a
generation prompt, then continue with a placeholder. Required assets for v1:

| Asset | Spec | Used in |
|---|---|---|
| `mascot-full.png` | skullbunny, transparent background, 2048 px tall | landing page, settings |
| `mascot-tray-16.ico` and `-32.ico` | skull-and-ears silhouette readable at 16 px, light and dark variants | tray icon |
| `mascot-empty.png` | mascot holding the plushy, 512 px | popover empty state |
| `mascot-loading.png` | mascot sniffing or squinting, 512 px | deep-lane loading |
| `mascot-error.png` | mascot shrugging, plushy dropped, 512 px | error states |
| `mascot-unsure.png` | mascot with a question mark, 512 px | all-gray results |
| `app-icon-256.png` | square app icon, flat, readable at 32 px | installer, taskbar |
| `og-image.png` | 1200 by 630 landing page share image with wordmark | site |
| `wordmark.svg` | "Callout" wordmark, single color | site, about page |

Mascot generation prompt to start from (partners will iterate in ChatGPT):
"A small cartoon skull with tall rabbit ears, eyes drawn as two flat horizontal
lines, sly closed-mouth expression. Wears a plain black T-shirt with 'EAT THE
RICH' in white block letters. Holds a small green robot plushy in both arms:
round head, huge round eyes, wide unhinged grin, floppy dog-suit hood with
ears, a clear homage to a certain cartoon robot but an original design. Flat
vector style, thick outlines, limited palette, transparent background."

First message to send back: a short plan for step 1, the stack choice with
one-paragraph reasoning, and any question you cannot answer from the two docs.
