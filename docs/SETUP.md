# Setting up Callout (beta testers)

Callout runs on your machine with your own API keys. There is no Callout
account. Setup is three keys, one of them required.

## 1. Install

Run the installer from your invite email. Callout lives in the system tray.
The first launch opens Settings.

## 2. TypeSafe key (required)

This powers every judgment. Get a key at https://console.typesafe.ai, paste it
into the TypeSafe field in Settings, and press **Test and save**. With only
this key, the fast lane works: signals and persuasion techniques, no source
fetching.

## 3. Tavily key (recommended)

This finds web evidence for the deep lane. Get a key at
https://app.tavily.com, paste, test, save. Without it, Callout can only check
claims against links already in the text.

## 4. LLM helper key (recommended)

The helper extracts claims, reads screenshots, answers your questions, and
writes the two-sentence summary. It never judges. Default provider is
DeepSeek: get a key at https://platform.deepseek.com, paste, test, save. The
helper switches on when the test passes.

Any OpenAI-compatible or Anthropic endpoint works. Pick a preset or choose
Custom and fill in the base URL, model, and wire format.

## 5. Use it

Highlight text anywhere and press **Ctrl+Shift+Space** (change it in
Settings). Or copy a URL and press the key. Or click the tray icon.

- Fast lane appears first. The header always reads "Signals in the text
  itself. Not a truth check."
- If there is something checkable, the deep lane starts (or shows a **Check
  claims** button). Rows turn green, amber, red, or stay gray with a reason.
- Tap a row for the quote, the best source passage, and the link.
- The box at the bottom takes pasted text, a URL, or (with the helper on and
  after a deep check) a question about what is on screen.
- The screenshot button grabs a region and sends it to the helper's vision
  model. Needs the helper on.
- Esc closes the popover.

## What leaves your machine

Text you check goes to TypeSafe, your LLM provider, and Tavily, plus the pages
Callout fetches. Nothing goes to the partners. Keys are in the Windows
credential store. History is off unless you turn it on.

## Feedback

Settings has **Copy feedback report**. It copies verdict counts, usage, and
the build number. Checked text is included only if you tick the box. Paste it
into the feedback form from your invite.
