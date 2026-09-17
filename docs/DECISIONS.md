# Decisions

Stack and design choices made during the build, with reasoning. The fixed
decisions from `HANDOFF.md` are not repeated here.

## 2026-09-17: Shell is Tauri 2

Tauri over Electron. The app is always-on in the tray (PRD N3), and a Tauri
binary idles at a few tens of megabytes against Electron's hundreds. Every
capability step 1 needs is first-party in Tauri 2: `tauri-plugin-global-shortcut`
for the hotkey, `tauri-plugin-clipboard-manager` for reading and restoring the
clipboard, the built-in tray icon, and a frameless always-on-top popover
window. The two things Tauri does not do are done in a few lines of Rust with
mature crates: the simulated Ctrl+C for selection capture (`enigo`), and the
full-screen grab for region screenshots (`xcap`). Electron would need a native
module (robotjs or nut.js) for the synthetic keypress, which is the part that
most often breaks on Windows updates. Frontend is plain TypeScript with Vite
and no UI framework: the popover is one column and a few dozen DOM nodes.

Verified with `cargo check --target x86_64-pc-windows-gnu` from Linux (the msvc target needs `lib.exe`, which only exists on Windows; the gnu target works with `apt install mingw-w64`). Zero warnings. A real
Windows build and the hotkey acceptance test run on a Windows machine or the
GitHub Actions Windows runner (`.github/workflows/build.yml`).

## 2026-09-17: Engine is pure TypeScript with injected I/O

Everything under `engine/` has no Tauri or DOM dependency. `fetch` and an
HTML parser are injected: the Tauri HTTP plugin and the native `DOMParser` in
the app, Node `fetch` and `linkedom` in tests and the eval script. This is what
makes the fast lane, deep lane, and helper testable here without a Windows
build, and what lets the same code run the 20-sample eval from the command
line.

## 2026-09-17: API calls go through the Tauri HTTP plugin, not the webview fetch

The webview enforces CORS. TypeSafe, DeepSeek, and Tavily may or may not send
permissive headers, and fetched web pages certainly do not. The Tauri HTTP
plugin performs requests from the Rust side and returns them to the webview, so
all engine network calls use it. The TypeSafe SDK accepts a custom `fetch`, so
`@typesafe-ai/sdk` is used as specified with the plugin's fetch passed in.

## 2026-09-17: Tavily via its REST endpoint, not `@tavily/core`

The handoff asked for Tavily's official SDK. `@tavily/core` depends on axios
and cannot be routed through the Tauri HTTP plugin, so it would hit CORS in the
webview. `engine/deeplane/search.ts` is a forty-line client on the documented
`POST https://api.tavily.com/search` endpoint with the same fields. Swap back to
the SDK if Tavily ships a fetch-based client.

## 2026-09-17: LLM helper adapter is raw HTTP, two wire formats

One interface (`LlmHelper`) with two implementations of the wire: OpenAI
chat completions and Anthropic messages. Raw HTTP with an injected fetch,
for the same CORS reason as above, and because the default provider is
DeepSeek, not Anthropic. DeepSeek's live docs (read 2026-09-17):

- Model ID: `deepseek-flash`, served by DeepSeek-V4.1-Flash. The legacy
  `deepseek-v4-flash` name is still accepted.
- Vision: supported on `deepseek-flash`. 1M context, 384K max output.
- Pricing per 1M tokens: input cache miss $0.15 off-peak / $0.30 peak; input
  cache hit $0.003 / $0.006; output $0.60 / $1.20. Peak is 01:00 to 04:00 and
  06:00 to 10:00 UTC on weekdays.
- Thinking mode is on by default and spends the output budget on
  chain-of-thought before the JSON. The helper sends
  `thinking: {type: "disabled"}` (OpenAI format) or `output_config.effort:
  "none"` (Anthropic format) when the base URL is DeepSeek. The helper only
  extracts and transcribes; it does not need to reason.
- Base URLs: `https://api.deepseek.com` (OpenAI format) and
  `https://api.deepseek.com/anthropic` (Anthropic format).

If a tester picks Anthropic's own API, the same adapter sends a plain
`/v1/messages` request with no thinking parameter, so current models decide
adaptively. The Anthropic preset defaults to `claude-opus-5`.

## 2026-09-17: Keys in Windows Credential Manager via `keyring`

Rust `keyring` crate, default `v1` feature, which on Windows uses the native
credential store. Service name `callout`, one entry per key: `typesafe`,
`tavily`, `llm`. The frontend never persists a key; it asks Rust for it when
building a client. Non-secret settings live in a JSON store via
`tauri-plugin-store`.

## 2026-09-17: The fixed header stays fixed

PRD 10c allows jokes in "the fast-lane header rotation", and PRD 5 fixes the
header text to "Signals in the text itself. Not a truth check." The header is
fixed. The rotating line from the bank shows only in the empty state and while
loading, above the header, and disappears when results arrive. A reader must
never confuse a joke for a finding.

## 2026-09-17: Fabricated-quote rule needs the cited source fetched

Red for a fabricated quote (PRD F20) fires only when the text cites a URL, the
claim attributes quoted words to that source, the source fetched cleanly, and
the quoted words are not in it after whitespace and quote normalization. A
quote with no cited URL goes through the normal support path. PDFs are not
parsed in v1, so a quote cited to a PDF lands as unsure with "sources could not
be fetched". Recorded as a known gap; sample `s11` in the eval set exercises it.

## 2026-09-17: Without the helper, the deep lane is narrow on purpose

With only a TypeSafe key, the fast lane runs. With TypeSafe and Tavily but no
LLM, the deep lane treats each sentence with a number or a URL as a candidate
claim and searches for it verbatim. Recall is poor, precision is unaffected
because Jev still judges every passage. The settings page says so.

## 2026-09-17: Screenshot region select happens in the webview

Rust grabs the full monitor under the cursor with `xcap` and hands the PNG to
a borderless full-screen window. The user drags a rectangle; the webview crops
with a canvas and sends the base64 PNG to the helper's vision model. This
avoids a second native overlay implementation and works the same on every
monitor layout.

## 2026-09-17: The helper gets a labelled second opinion, and a BS meter

Field test result: a fabricated news story with no web coverage came back
gray "unsupported" on every claim, because Jev has no knowledge of the world
and Tavily found nothing to contradict it. Sourced-only verdicts cannot call
an invented story a lie. That is the case the product exists for.

Change, keeping the honesty rules intact:

- Sourced verdicts are unchanged. Green still needs a supporting source, red
  still needs a contradicting source or a fabricated quote (PRD F20).
- After the sourced pass, the helper reads the text plus the sourced verdicts
  and gives its own call per claim from general knowledge: likely false,
  likely true, or can't tell, with a one-line reason. It is shown on the row
  as "Helper: Likely false (from the helper's general knowledge, no source
  fetched)" with a hollow dot, never the solid sourced color. A helper call
  never overrides a sourced verdict.
- The helper also writes a two-to-three sentence verdict write-up and an
  intent call (honest, careless, deceptive, unclear). Jev checks each write-up
  sentence for consistency with the verdict list and drops any that asserts a
  verdict the list does not contain. This replaces the passage-only summary
  when the helper is on; the passage-only summary remains as the fallback.
- BS meter: computed in code from the rows. False = sourced contradiction,
  fabricated quote, or helper likely-false on a row with no sourced support.
  Levels and labels live in `content/questions.yaml` under `meter`: "Pants on
  fire" (flame) at 90 percent false, or 60 percent with deceptive intent;
  "Mostly false" (smoke) from 60; "Holds up" (halo) at 10 or under; "Mixed"
  between. The percent drives the bar width only; the reader sees words.

The mascot and jokes stay out of the meter and the write-up. The flame,
smoke, and halo are the meter's own states, not the mascot.
