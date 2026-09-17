# Callout

Press a hotkey over anything you are reading. A small popover tells you
whether the text is trying to manipulate you (fast lane, under a second) and
whether its specific claims hold up against sources it actually fetched (deep
lane, a few seconds). Unsure is a real answer. Nothing is shown without a
source. The header on every result: **Signals in the text itself. Not a truth
check.**

Windows tray app, open source (MIT), bring your own keys. A joint product of
the little ai company and Wazoo. Currently in private beta.

## How it works

- **Jev** (TypeSafe's System One model) judges: content kind, the
  manipulation battery, passage relevance, claim-versus-evidence support, and
  every sentence the helper writes. Jev returns probabilities, never prose.
- **Code** owns the flow, caps, caches, and every threshold. All of them live
  in `content/questions.yaml`, which is the only place question wording lives.
- **The LLM helper** (DeepSeek V4.1 Flash by default, any OpenAI-compatible or
  Anthropic endpoint) only extracts claims, writes search queries, reads
  screenshots, transcribes, and drafts the two-sentence summary. It never
  judges, and every sentence it produces goes back through Jev.
- **Tavily** finds web evidence after sources cited in the text itself.

## Repository

| Path | What |
|---|---|
| `engine/` | Pure TypeScript engine: fast lane, deep lane, Jev client, helper adapter, fetching. No Tauri or DOM dependency. Tested with Vitest. |
| `content/` | `questions.yaml` (every Jev question, label, threshold), `lines.yaml` (the joke bank, tagged by surface), `helper-prompts.yaml`. |
| `src/` | Popover, settings wizard, and screenshot overlay. Plain TypeScript with Vite. |
| `src-tauri/` | Rust shell: tray, hotkey, clipboard capture, credential store, screenshot grab. |
| `site/` | Landing page and the Resend signup function. |
| `test/` | Unit tests, the 20-sample eval set, and the eval runner. |
| `docs/` | PRD, technical plan, handoff, decisions, assets, setup guide, costs. |

## Develop

```sh
npm install
npm test                 # engine tests (no keys needed; a live DeepSeek test runs if DEEPSEEK_API_KEY is set)
npm run typecheck
npm run dev              # popover in a browser at http://localhost:1420 (no hotkey, no secrets)
npm run tauri dev        # the real app; needs Rust and, on Windows, the WebView2 runtime
npm run tauri build      # signed installer when signing secrets are set (see .github/workflows/build.yml)
```

Run the 20-sample acceptance set against real keys and write a human review
sheet plus a cost table:

```sh
TYPESAFE_API_KEY=... TAVILY_API_KEY=... DEEPSEEK_API_KEY=... npm run eval:samples
```

Windows is the only shipping target in v1. The engine and UI build and test
on any OS; the Rust shell type-checks on Linux with
`cargo check --target x86_64-pc-windows-msvc` and is built for real by the
Windows CI job.

## Privacy

No server, no account, no telemetry. Text you check goes to the three APIs
you configure and to the pages Callout fetches for evidence. Keys sit in the
Windows credential store. History is off by default. Usage counters are
always on and stay on your machine.

## Docs

- `docs/PRD.md` and `docs/PLAN.md`: what and how, binding.
- `docs/DECISIONS.md`: stack choices and their reasons.
- `docs/SETUP.md`: tester guide to the three keys.
- `docs/ASSETS.md`: art the partners produce, with prompts.
- `docs/COSTS.md`: usage and cost table, filled from real runs.
