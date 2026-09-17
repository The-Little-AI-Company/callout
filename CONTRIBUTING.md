# Contributing to Callout

Thanks for looking. Callout is small on purpose, and most of what makes it
good lives in three YAML files rather than in code. This page says where
things are, how to run them, and what a good change looks like. The same
guide, with more context, is on the site:
https://the-little-ai-company.github.io/callout/docs/contributing.html

## Ground rules

- **Honesty rules are not negotiable.** No verdict without a shown source.
  Sourced red needs a contradicting source or a fabricated quote. Helper calls
  are always labelled as helper calls. Unsure names its reason. Confidence in
  words, never numbers. Jokes never appear in verdict copy. Pull requests that
  bend these are closed, however clever.
- **Code owns the flow. Models judge.** Jev (TypeSafe) answers narrow typed
  questions. The LLM helper extracts, transcribes, writes queries, drafts the
  write-up, and gives a labelled second opinion. Every threshold and every
  question lives in `content/questions.yaml`, never inline.
- **Nothing leaves the machine** except calls to the three user-configured
  APIs and the pages fetched for evidence. No analytics, no telemetry, no
  server. A PR that adds any of those is closed.
- **Attribution.** MIT licensed, copyright Jeff Kazzee. Keep the notice.

## Where things are

| Path | What |
|---|---|
| `content/questions.yaml` | Every Jev question, label, threshold, verdict string, meter level. The most valuable file to improve. |
| `content/lines.yaml` | The joke bank, tagged by surface. Never used in verdicts. |
| `content/helper-prompts.yaml` | LLM helper prompts: extract, queries, explain, judge, transcribe, answer. |
| `engine/` | Pure TypeScript. Fast lane, deep lane, Jev client, helper adapter, fetching. No Tauri, no DOM. |
| `src/` | Popover, settings, screenshot overlay. Plain TypeScript, Vite. |
| `src-tauri/` | Rust shell: tray, hotkey, clipboard capture, credential store, screen grab, windows. |
| `site/` | The GitHub Pages site and docs. |
| `test/` | Vitest suites, the 20-sample eval set, the eval runner. |
| `docs/` | PRD, plan, decisions, assets, setup, costs. |

## Running it

```sh
npm install
npm test            # engine and site tests; a live DeepSeek test runs if DEEPSEEK_API_KEY is set
npm run typecheck
npm run dev         # popover in a browser at http://localhost:1420 (no hotkey, no secrets)
npm run tauri dev   # the real app on Windows; needs Rust and WebView2
```

Copy `.env.example` to `.env` for keys used by tests and the eval script. The
app itself never reads `.env`; users paste keys into Settings.

Rust can be type-checked from Linux or Mac for the Windows target:

```sh
rustup target add x86_64-pc-windows-gnu
cd src-tauri && cargo check --target x86_64-pc-windows-gnu
```

The real Windows build runs in CI on every push (`.github/workflows/build.yml`).
Download the installer from the run's artifacts to test a branch.

## Evaluating a change to questions or prompts

```sh
npm run eval:samples
```

Runs the fast lane and deep lane over `test/samples/samples.json` with real
keys and writes `test/eval/out/<run>/review.md` (verdicts and links for a human
to mark right or wrong) and `costs.md` (tokens by lane and step). Attach both
to a PR that changes `content/` so reviewers can see the effect. Add samples
when you find a case the app gets wrong.

## Changing a question, label, or threshold

1. Edit `content/questions.yaml`. Every technique has a reader label, a jargon
   name, an instruction, and `true` and `false` criteria with examples. Keep
   labels plain: "Makes you feel you must act now", not "urgency appeal".
2. Run `npm test`. The content test checks ids are unique, families are
   complete, and verdict copy has no jokes.
3. Run the eval and look at what moved.

## Adding a joke line

Edit `content/lines.yaml` under the surface it belongs to. Aim at the text
being checked, at manipulation techniques, or at the mascot. Never at the
reader. Never imply a verdict. Keep it under about sixty characters.

## Pull requests

- One build-order step or less per PR. Small and reviewable.
- Say what you tested on Windows and what you did not.
- CI must be green: tests, type check, and the Windows build.
- No new dependencies without a sentence on why. The app is meant to idle
  small in the tray.
- Match the existing voice in copy: dry, plain, no exclamation marks in
  anything a reader sees as a finding.

## Releases

Maintainers tag `vX.Y.Z` on `main`. CI builds, then publishes a GitHub
Release with `Callout-Setup.exe` and `Callout.msi`. The site's download button
follows the latest release automatically. Bump the version in `package.json`,
`src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` first.

## Reporting a problem

Open an issue with the build number from Settings, what you highlighted (or
that you would rather not say), what the popover showed, and what you
expected. Settings has a "Copy feedback report" button that gathers the build
and usage counts without any checked text unless you tick the box.
