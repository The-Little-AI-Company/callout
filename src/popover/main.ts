/**
 * The popover. One column: header, fast lane, manipulation section, claim
 * rows, summary, one input box. No chat transcript (PRD section 5).
 *
 * Jokes come only from the line bank and only appear in the empty, loading,
 * and error surfaces. Verdict copy is literal and comes from questions.yaml.
 */
import { h, clear } from "../dom";
import { app, listen, secrets, httpFetch, openUrl, type CapturePayload, type ScreenshotPayload } from "../app/tauri";
import { buildEngine, type Engine } from "../app/engine";
import { questions, prompts, line } from "../app/content";
import { appendHistory } from "../app/history";
import { runFastLane } from "@engine/fastlane";
import { runDeepLane, checkAnswerSentences } from "@engine/deeplane";
import { answerQuestion, transcribeImage } from "@engine/helper/tasks";
import { fetchYouTubeTranscript } from "@engine/fetch/video";
import { isBareUrl, isVideoUrl, looksLikeQuestion, truncate } from "@engine/text/sentences";
import { describeError } from "@engine/jev/client";
import type { Capture, CaptureSource, ClaimVerdict, DeepLaneResult, Explanation, FastLaneResult } from "@engine/types";
import mascotUrl from "../assets/placeholder-mascot.svg";

type Phase = "empty" | "loading" | "result" | "error";

interface State {
  phase: Phase;
  joke: string;
  capture?: Capture;
  fast?: FastLaneResult;
  deep: { status: "idle" | "waiting" | "running" | "done" | "error"; claims: ClaimVerdict[]; result?: DeepLaneResult; explanation?: Explanation; error?: string };
  answer?: { sentences: { text: string; backed: boolean }[]; pending?: boolean };
  expanded?: string;
  error?: { message: string; surface: string };
  note?: string;
}

const root = document.getElementById("app")!;
let state: State = { phase: "empty", joke: line("empty"), deep: { status: "idle", claims: [] } };
let engine: Engine | undefined;
let abort: AbortController | undefined;

async function getEngine(): Promise<Engine> {
  engine ??= await buildEngine();
  return engine;
}

function set(patch: Partial<State>): void {
  state = { ...state, ...patch };
  render();
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

async function runCheck(rawText: string, source: CaptureSource): Promise<void> {
  abort?.abort();
  abort = new AbortController();
  const signal = abort.signal;
  engine = await buildEngine(); // re-read settings and keys every check; the wizard may have changed them
  const th = questions.thresholds;

  if (engine.missing.typesafe) {
    set({ phase: "error", error: { message: "Add your TypeSafe key in settings to start.", surface: "error_key" }, joke: line("error_key") });
    return;
  }

  let text = rawText.trim();
  let note: string | undefined;

  // A bare URL: page or video (PRD F3, F4a, F4c).
  if (isBareUrl(text)) {
    set({ phase: "loading", joke: line("loading_fast"), note: undefined, capture: undefined, fast: undefined, answer: undefined, deep: { status: "idle", claims: [] } });
    if (!engine.online) {
      set({ phase: "error", error: { message: line("offline"), surface: "offline" }, joke: "" });
      return;
    }
    if (isVideoUrl(text)) {
      const t = await fetchYouTubeTranscript(text, httpFetch as never);
      if ("error" in t) {
        set({ phase: "error", error: { message: `${t.error} Frame sampling is not in this build.`, surface: "error_generic" }, joke: line("error_generic") });
        return;
      }
      source = { kind: "video", url: text, title: t.title, helperOutput: false };
      note = "Transcript from the video's captions.";
      text = t.text;
    } else {
      const page = await engine.fetcher.fetchPage(text);
      if (page.status !== "ok") {
        set({ phase: "error", error: { message: `Could not read that page: ${page.error ?? page.status}.`, surface: "error_generic" }, joke: line("error_generic") });
        return;
      }
      source = { kind: "page", url: text, title: page.title, helperOutput: false };
      text = page.text;
    }
  }

  if (text.length < th.min_text_chars) {
    set({ phase: "error", error: { message: line("too_short"), surface: "too_short" }, joke: "" });
    return;
  }
  const cut = truncate(text, th.max_text_chars);
  if (cut.truncated) note = note ? `${note} ${line("too_long")}` : line("too_long");
  text = cut.text;

  const capture: Capture = { text, source, capturedAt: Date.now() };
  set({ phase: "loading", joke: line("loading_fast"), capture, fast: undefined, note, answer: undefined, expanded: undefined, deep: { status: "idle", claims: [] } });

  let fast: FastLaneResult;
  try {
    fast = await runFastLane(engine.jev!, questions, capture, { signal });
  } catch (e) {
    if (signal.aborted) return;
    const msg = describeError(e);
    const surface = /reach|connection/i.test(msg) ? "error_network" : /key|401/i.test(msg) ? "error_key" : "error_generic";
    set({ phase: "error", error: { message: msg, surface }, joke: line(surface) });
    return;
  }
  if (signal.aborted) return;

  const wantsDeep = fast.worthDeepCheck.choice !== "no" && !fast.factualHiddenReason;
  const autoDeep = fast.autoDeepCheck && engine.settings.autoDeepCheck;
  set({ phase: "result", fast, deep: { status: wantsDeep ? (autoDeep ? "running" : "waiting") : "idle", claims: [] } });
  if (engine.settings.historyOn) void appendHistory(text, source, fast);
  if (autoDeep) void runDeep();
}

async function runDeep(): Promise<void> {
  const eng = await getEngine();
  const capture = state.capture;
  if (!capture || !eng.jev) return;
  const signal = abort?.signal;
  set({ deep: { ...state.deep, status: "running", claims: [] }, joke: line("loading_deep") });
  const result = await runDeepLane(
    { jev: eng.jev, content: questions, llm: eng.llm, prompts, fetcher: eng.fetcher, search: eng.search, online: eng.online },
    { text: capture.text, pageUrl: capture.source.kind === "page" ? capture.source.url : undefined, signal },
    (e) => {
      if (signal?.aborted) return;
      if (e.type === "claims") set({ deep: { ...state.deep, claims: e.claims } });
      else if (e.type === "claim") set({ deep: { ...state.deep, claims: state.deep.claims.map((c) => (c.claim.id === e.claim.claim.id ? e.claim : c)) } });
      else if (e.type === "status") set({ deep: { ...state.deep, status: "running", claims: state.deep.claims }, joke: e.message === "explaining" ? "Writing it up." : state.joke });
      else if (e.type === "explanation") set({ deep: { ...state.deep, explanation: e.explanation } });
      else if (e.type === "error") set({ deep: { ...state.deep, status: "error", error: e.message } });
      else if (e.type === "done") set({ deep: { ...state.deep, status: state.deep.status === "error" ? "error" : "done", result: e.result, claims: e.result.claims } });
    },
  );
  if (signal?.aborted) return;
  if (eng.settings.historyOn && state.fast) void appendHistory(capture.text, capture.source, state.fast, result);
}

async function onInput(value: string): Promise<void> {
  const v = value.trim();
  if (!v) return;
  const eng = await getEngine();
  if (looksLikeQuestion(v) && state.deep.status === "done") {
    if (!eng.llm) {
      set({ note: line("helper_off_input") });
      return;
    }
    await askQuestion(v);
    return;
  }
  await runCheck(v, { kind: isBareUrl(v) ? "page" : "paste", helperOutput: false });
}

/** Follow-up answers come only from Jev-judged passages and every sentence is checked (PRD F14d). */
async function askQuestion(question: string): Promise<void> {
  const eng = await getEngine();
  if (!eng.llm || !eng.jev) return;
  set({ answer: { sentences: [], pending: true } });
  const passages = state.deep.claims.flatMap((c) => c.judgments.map((j) => `(${j.passage.url}) ${j.passage.text}`));
  if (passages.length === 0) {
    set({ answer: { sentences: [{ text: "There is no judged evidence for this check yet, so I cannot answer from it.", backed: true }] } });
    return;
  }
  try {
    const sentences = await answerQuestion(eng.llm, prompts, question, passages.join("\n\n"));
    const checked = await checkAnswerSentences({ jev: eng.jev, content: questions }, sentences, passages);
    set({ answer: { sentences: checked } });
  } catch (e) {
    set({ answer: { sentences: [{ text: `The helper could not answer: ${e instanceof Error ? e.message : String(e)}`, backed: true }] } });
  }
}

async function onScreenshot(payload: ScreenshotPayload): Promise<void> {
  const eng = await buildEngine();
  if (!eng.llm) {
    set({ phase: "error", error: { message: line("screenshot_no_helper"), surface: "screenshot_no_helper" }, joke: "" });
    return;
  }
  set({ phase: "loading", joke: "Reading the picture.", capture: undefined, fast: undefined, deep: { status: "idle", claims: [] } });
  try {
    const text = await transcribeImage(eng.llm, prompts, { mediaType: "image/png", base64: payload.png });
    await runCheck(text, { kind: "screenshot", helperOutput: true });
  } catch (e) {
    set({ phase: "error", error: { message: `The helper could not read the screenshot: ${e instanceof Error ? e.message : String(e)}`, surface: "error_generic" }, joke: line("error_generic") });
  }
}

function close(): void {
  abort?.abort();
  void app.hidePopover();
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render(): void {
  clear(root);
  root.append(
    h("div", { class: "head" },
      h("span", { class: "title" }, "Callout"),
      h("div", { class: "actions" },
        h("button", { class: "iconbtn", title: "Screenshot a region", "aria-label": "Screenshot a region", onClick: () => void app.startScreenshot() }, "▣"),
        h("button", { class: "iconbtn", title: "Settings", "aria-label": "Settings", onClick: () => void app.openSettings() }, "⚙"),
        h("button", { class: "iconbtn", title: "Close (Esc)", "aria-label": "Close", onClick: close }, "✕"),
      ),
    ),
    h("div", { class: "body", role: "region", "aria-live": "polite" }, ...body()),
    inputBox(),
  );
  void app.resizePopover(root.getBoundingClientRect().height);
}

function body(): Node[] {
  const s = state;
  if (s.phase === "empty") {
    const hk = (engine?.settings.hotkey ?? "CommandOrControl+Shift+Space").replace("CommandOrControl", "Ctrl").replace(/\+/g, " + ");
    return [
      h("div", { class: "empty" }, h("img", { src: mascotUrl, alt: "" }), h("p", { class: "joke" }, s.joke)),
      h("p", { class: "note" }, "Highlight text anywhere and press ", h("kbd", {}, hk), ", or paste below."),
    ];
  }
  if (s.phase === "error") {
    return [h("div", { class: "state" }, h("img", { src: mascotUrl, alt: "" }), h("div", {}, h("p", { class: "error", role: "alert" }, s.error?.message ?? ""), s.joke ? h("p", { class: "joke" }, s.joke) : null))];
  }
  if (s.phase === "loading" || !s.fast) {
    return [h("div", { class: "state" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("span", { class: "joke" }, s.joke || "Working.")), h("p", { class: "header-line" }, questions.fast_lane.header)];
  }
  const f = s.fast;
  const out: Node[] = [];
  out.push(h("p", { class: "header-line" }, f.header));
  if (s.note) out.push(h("p", { class: "note" }, s.note));
  if (s.capture?.source.helperOutput) out.push(h("p", { class: "note" }, "Text below was transcribed by the helper, then judged."));
  out.push(h("p", {}, h("span", { class: "kind" }, f.contentKindLabel), f.factualHiddenReason ? h("span", { class: "note" }, ` ${f.factualHiddenReason}`) : null));

  if (f.signals.length) {
    out.push(h("p", { class: "section-title" }, "Signals"));
    out.push(h("ul", { class: "signals" }, ...f.signals.map((sig) => h("li", { class: "signal" }, h("span", { class: "label" }, sig.label), h("span", { class: "why" }, sig.why)))));
  }

  out.push(h("p", { class: "section-title" }, "How it's trying to persuade you"));
  out.push(h("p", { class: "level" }, "Overall: ", h("b", {}, f.manipulationLevel.label)));
  if (f.techniques.length) {
    out.push(h("ul", { class: "techniques" }, ...f.techniques.map((t) => h("li", { class: "technique" },
      h("span", { class: "label" }, t.label),
      t.example ? h("span", { class: "example" }, t.example) : null,
      h("details", {}, h("summary", { class: "jargon" }, "more"), h("span", { class: "jargon" }, `${t.jargon}. Family: ${t.family.replace(/_/g, " ")}.`)),
    ))));
  } else {
    out.push(h("p", { class: "note" }, "No persuasion technique stood out."));
  }

  out.push(...deepSection());
  return out;
}

function deepSection(): Node[] {
  const d = state.deep;
  const out: Node[] = [];
  if (d.status === "idle") return out;
  out.push(h("p", { class: "section-title" }, "Claims"));
  if (d.status === "waiting") {
    out.push(h("p", { class: "joke" }, line("deep_waiting")));
    out.push(h("div", { class: "row-actions" }, h("button", { class: "btn primary", onClick: () => void runDeep() }, "Check claims")));
    return out;
  }
  if (d.status === "running" && d.claims.length === 0) {
    out.push(h("div", { class: "state" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("span", { class: "joke" }, state.joke)));
  }
  if (d.status === "error") out.push(h("p", { class: "error", role: "alert" }, d.error ?? "The deep check failed."));
  if (d.claims.length) {
    out.push(h("ul", { class: "claims" }, ...d.claims.map(claimRow)));
  } else if (d.status === "done") {
    out.push(h("p", { class: "note" }, "No checkable claims were found."));
  }
  if (d.status === "done" && d.claims.length && d.claims.every((c) => ["unsure", "not_checkable", "incidental", "unsupported"].includes(c.verdict))) {
    out.push(h("div", { class: "state" }, h("img", { src: mascotUrl, alt: "" }), h("p", { class: "joke" }, line("all_unsure"))));
  }
  if (state.answer) {
    out.push(h("div", { class: "summary" },
      h("span", { class: "helper-tag" }, "Answer from the judged evidence (helper output, checked)"),
      state.answer.pending ? h("span", {}, h("span", { class: "spinner", "aria-hidden": "true" }), "Checking the answer.") : null,
      ...state.answer.sentences.map((s) => h("span", { class: s.backed ? "" : "unbacked" }, s.backed ? `${s.text} ` : "Not in the evidence. ")),
    ));
  } else if (d.explanation) {
    out.push(h("div", { class: "summary" },
      h("span", { class: "helper-tag" }, "Summary (helper output, checked against the sources)"),
      d.explanation.sentences.map((s) => `${s.text} `).join(""),
      d.explanation.warning ? h("span", { class: "warn" }, d.explanation.warning) : null,
    ));
  }
  return out;
}

function claimRow(c: ClaimVerdict): Node {
  const pending = state.deep.status === "running" && c.verdict === "unsure" && !c.unsureReason;
  const open = state.expanded === c.claim.id;
  const dotClass = pending ? "dot pending" : `dot ${c.verdict}`;
  const verdictText = pending ? "Checking" : c.verdictLabel;
  return h("li", { class: "claim" },
    h("button", { "aria-expanded": open ? "true" : "false", onClick: () => set({ expanded: open ? undefined : c.claim.id }) },
      h("span", { class: dotClass, "aria-hidden": "true" }),
      h("span", {},
        h("span", { class: "text" }, c.claim.text),
        h("br"),
        h("span", { class: "verdict" }, h("span", { class: "vlabel" }, verdictText), pending || c.verdict === "not_checkable" || c.verdict === "incidental" ? null : h("span", { class: "band" }, ` · ${c.bandLabel}`)),
        c.why && !pending ? h("span", { class: "why" }, h("br"), c.why) : null,
      ),
    ),
    open ? evidence(c) : null,
  );
}

function evidence(c: ClaimVerdict): Node {
  const parts: Node[] = [h("div", { class: "from" }, "From the text: "), h("blockquote", {}, c.claim.quote)];
  if (c.best) {
    parts.push(h("div", { class: "from" }, "Best source passage: "), h("blockquote", {}, c.best.passage.text.slice(0, 700)));
    parts.push(h("div", { class: "from" }, h("a", { href: c.best.passage.url, onClick: (e) => { e.preventDefault(); void openUrl(c.best!.passage.url); } }, c.best.passage.title || c.best.passage.url)));
  } else if (c.unsureReason) {
    parts.push(h("div", { class: "from" }, c.why));
  }
  if (c.judgments.length > 1) {
    parts.push(h("div", { class: "from" }, `${c.judgments.length} passages judged: ${c.judgments.filter((j) => j.relation === "supports").length} support, ${c.judgments.filter((j) => j.relation === "contradicts").length} contradict, ${c.judgments.filter((j) => j.relation === "says_nothing").length} say nothing.`));
  }
  parts.push(h("div", { class: "from" }, `Threshold in force: ${c.thresholds.support_confidence}.`));
  return h("div", { class: "evidence" }, ...parts);
}

// The input box is created once so typed text survives re-renders.
const inputEl = h("input", { type: "text", "aria-label": "Paste text or a URL to check" });
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitInput();
});
function submitInput(): void {
  const v = inputEl.value;
  inputEl.value = "";
  void onInput(v);
}
function inputBox(): Node {
  const helperOn = !!engine?.llm;
  const placeholder = helperOn && state.deep.status === "done" ? "Paste text or a URL, or ask about what's on screen" : "Paste text or a URL to check";
  inputEl.placeholder = placeholder;
  inputEl.setAttribute("aria-label", placeholder);
  return h("div", { class: "inputbox" }, inputEl, h("button", { class: "btn", onClick: submitInput }, "Check"));
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") close();
});

void listen<CapturePayload>("callout://capture", (p) => {
  void runCheck(p.text, { kind: p.kind, url: p.url, title: p.title, helperOutput: false });
});
void listen<ScreenshotPayload>("callout://screenshot", (p) => void onScreenshot(p));
void listen<void>("callout://settings-changed", () => {
  engine = undefined;
  render();
});

// Dev in a plain browser: expose a way to trigger a capture from the console.
(window as unknown as { calloutCheck?: (t: string) => void }).calloutCheck = (t: string) => void runCheck(t, { kind: "paste", helperOutput: false });

void (async () => {
  await getEngine();
  // First run: send the tester to settings if there is no TypeSafe key.
  if (engine?.missing.typesafe && !(await secrets.get("typesafe"))) {
    state.joke = "Add your TypeSafe key in settings to start. The other two keys are optional.";
  }
  render();
})();
