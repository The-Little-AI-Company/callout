/**
 * Settings and first-run wizard (PRD F15 to F19, F22, L6, L7).
 */
import { h, clear } from "../dom";
import { app, emit, openUrl, secrets, type SecretName } from "../app/tauri";
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from "../app/settings";
import { usage as usageLog, clearUsage, llmConfig } from "../app/engine";
import { line } from "../app/content";
import { clearHistory, readHistory } from "../app/history";
import { JevClient } from "@engine/jev/client";
import { LlmClient, PRESETS } from "@engine/helper/llm";
import { TavilyClient } from "@engine/deeplane/search";
import { httpFetch } from "../app/tauri";
import type { ApiName } from "@engine/types";
import mascotUrl from "../assets/placeholder-mascot.svg";

const root = document.getElementById("app")!;
let settings: Settings = { ...DEFAULT_SETTINGS };
let keysPresent: Record<SecretName, boolean> = { typesafe: false, tavily: false, llm: false };
const keyStatus: Record<SecretName, { cls: string; text: string }> = { typesafe: { cls: "", text: "" }, tavily: { cls: "", text: "" }, llm: { cls: "", text: "" } };
let build = { version: "", build: "", platform: "" };

const KEY_INFO: Record<SecretName, { title: string; url: string; note: string }> = {
  typesafe: { title: "TypeSafe (Jev)", url: "https://console.typesafe.ai", note: "Required. Powers the fast lane and every judgment." },
  tavily: { title: "Tavily (web search)", url: "https://app.tavily.com", note: "Optional. Without it the deep lane can only fetch sources the text links to." },
  llm: { title: "LLM helper", url: "https://platform.deepseek.com", note: "Optional. Extracts claims, reads screenshots, answers questions. Never judges." },
};

async function save(): Promise<void> {
  await saveSettings(settings);
  await emit("callout://settings-changed");
}

async function testKey(name: SecretName, value: string): Promise<void> {
  keyStatus[name] = { cls: "", text: "Testing." };
  render();
  const log = await usageLog();
  let result: { ok: true; ms: number } | { ok: false; error: string };
  if (!value.trim()) result = { ok: false, error: "Enter a key first." };
  else if (name === "typesafe") result = await new JevClient({ apiKey: value.trim(), usage: log, fetch: httpFetch as never }).test();
  else if (name === "tavily") result = await new TavilyClient(value.trim(), httpFetch as never, log).test();
  else result = await new LlmClient(llmConfig(settings, value.trim()), httpFetch as never, log).test();
  if (result.ok) {
    await secrets.set(name, value.trim());
    keysPresent[name] = true;
    if (name === "llm") {
      settings.helperOn = true;
      settings.helperDisabled = false;
    }
    if (name === "typesafe") settings.setupDone = true;
    await save();
    keyStatus[name] = { cls: "ok", text: `Works. ${result.ms} ms. Saved to the Windows credential store.` };
    if (name === "typesafe") setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
  } else {
    keyStatus[name] = { cls: "bad", text: result.error };
  }
  render();
}

async function removeKey(name: SecretName): Promise<void> {
  await secrets.delete(name);
  keysPresent[name] = false;
  if (name === "llm") settings.helperOn = false;
  keyStatus[name] = { cls: "", text: "Removed." };
  await save();
  render();
}

function hotkeyField(): Node {
  const input = h("input", { type: "text", value: settings.hotkey, "aria-label": "Hotkey. Press the combination you want.", readonly: true });
  const status = h("span", { class: "status" });
  input.addEventListener("keydown", async (e) => {
    e.preventDefault();
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push("CommandOrControl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (parts.length === 0 && !/^F\d{1,2}$/.test(e.key)) {
      status.textContent = "Use at least one modifier, or a function key.";
      status.className = "status bad";
      return;
    }
    const key = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
    const accel = [...parts, key].join("+");
    try {
      await app.setHotkey(accel);
      settings.hotkey = accel;
      input.value = accel;
      status.textContent = "Registered.";
      status.className = "status ok";
      await save();
    } catch (err) {
      status.textContent = `Could not register ${accel}: ${String(err)}`;
      status.className = "status bad";
    }
  });
  return h("div", {}, input, status);
}

function keyCard(name: SecretName): Node {
  const info = KEY_INFO[name];
  const input = h("input", { type: "password", placeholder: keysPresent[name] ? "Saved. Enter a new key to replace it." : "Paste the key", "aria-label": `${info.title} key` });
  return h("div", { class: "card" },
    h("h2", {}, info.title),
    h("p", { class: "small muted" }, info.note, " ", h("a", { href: "#", onClick: (e) => { e.preventDefault(); void openUrl(info.url); } }, "Get a key")),
    h("div", { class: "keyrow" },
      input,
      h("button", { class: "btn primary", onClick: () => void testKey(name, input.value) }, "Test and save"),
      h("button", { class: "btn", disabled: !keysPresent[name], onClick: () => void removeKey(name) }, "Remove"),
    ),
    h("div", { class: `status ${keyStatus[name].cls}`, role: "status" }, keyStatus[name].text || (keysPresent[name] ? "A key is saved." : "")),
    name === "llm" ? helperFields() : null,
  );
}

function helperFields(): Node {
  const presetSel = h("select", { "aria-label": "Provider preset" },
    ...(["deepseek", "deepseek_anthropic", "anthropic", "openai_compatible", "custom"] as const).map((p) => h("option", { value: p, selected: settings.llmPreset === p }, presetLabel(p))),
  );
  const base = h("input", { type: "text", value: settings.llmBaseURL, "aria-label": "Base URL" });
  const model = h("input", { type: "text", value: settings.llmModel, "aria-label": "Model" });
  const explainModel = h("input", { type: "text", value: settings.llmExplainModel, placeholder: "same as model", "aria-label": "Model for the summary step" });
  const wire = h("select", { "aria-label": "Wire format" }, h("option", { value: "openai", selected: settings.llmWire === "openai" }, "OpenAI-compatible"), h("option", { value: "anthropic", selected: settings.llmWire === "anthropic" }, "Anthropic messages"));
  presetSel.addEventListener("change", () => {
    settings.llmPreset = presetSel.value as Settings["llmPreset"];
    const p = PRESETS[settings.llmPreset];
    if (p) {
      settings.llmBaseURL = p.baseURL;
      settings.llmModel = p.model;
      settings.llmWire = p.wire;
      base.value = p.baseURL;
      model.value = p.model;
      wire.value = p.wire;
    }
    void save();
  });
  for (const [el, key] of [[base, "llmBaseURL"], [model, "llmModel"], [explainModel, "llmExplainModel"]] as const) {
    el.addEventListener("change", () => {
      (settings as unknown as Record<string, string>)[key] = el.value.trim();
      void save();
    });
  }
  wire.addEventListener("change", () => {
    settings.llmWire = wire.value as Settings["llmWire"];
    void save();
  });
  const helperToggle = h("input", { type: "checkbox", checked: !settings.helperDisabled, disabled: !keysPresent.llm, "aria-label": "Helper on" });
  helperToggle.addEventListener("change", () => {
    settings.helperDisabled = !(helperToggle as HTMLInputElement).checked;
    settings.helperOn = !settings.helperDisabled;
    void save();
  });
  return h("div", { style: "display:flex;flex-direction:column;gap:8px;margin-top:6px" },
    h("label", { class: "toggle" }, helperToggle, " Helper on (screenshots, messy paste, questions, summaries)"),
    h("div", { class: "field" }, h("label", {}, "Provider"), presetSel),
    h("div", { class: "field" }, h("label", {}, "Base URL"), base),
    h("div", { class: "field" }, h("label", {}, "Model"), model),
    h("div", { class: "field" }, h("label", {}, "Summary model"), explainModel),
    h("div", { class: "field" }, h("label", {}, "Wire format"), wire),
    h("p", { class: "small muted" }, "Default is DeepSeek V4.1 Flash (model id deepseek-flash), which reads images. Any OpenAI-compatible or Anthropic endpoint works."),
  );
}

function presetLabel(p: string): string {
  return { deepseek: "DeepSeek (OpenAI format)", deepseek_anthropic: "DeepSeek (Anthropic format)", anthropic: "Anthropic", openai_compatible: "OpenAI-compatible", custom: "Custom" }[p] ?? p;
}

async function usageTable(): Promise<Node> {
  const log = await usageLog();
  const apis: ApiName[] = ["typesafe", "llm", "tavily"];
  const rows = apis.map((api) => {
    const t = log.totals(api);
    const p = settings.prices;
    const est = api === "typesafe" ? (t.inputTokens * p.typesafeInput + t.outputTokens * p.typesafeOutput) / 1e6 : api === "llm" ? (t.inputTokens * p.llmInput + t.outputTokens * p.llmOutput) / 1e6 : t.calls * p.tavilyPerCall;
    return h("tr", {}, h("td", {}, api), h("td", { class: "num" }, String(t.calls)), h("td", { class: "num" }, String(t.inputTokens)), h("td", { class: "num" }, String(t.outputTokens)), h("td", { class: "num" }, est ? `$${est.toFixed(4)}` : "fill in prices"));
  });
  const priceField = (label: string, key: keyof Settings["prices"]) => {
    const input = h("input", { type: "number", step: "0.001", value: String(settings.prices[key]), "aria-label": label });
    input.addEventListener("change", () => {
      settings.prices[key] = Number(input.value) || 0;
      void save().then(render);
    });
    return h("div", { class: "field" }, h("label", {}, label), input);
  };
  return h("div", { class: "card" },
    h("h2", {}, "Usage"),
    h("table", { class: "usage" },
      h("thead", {}, h("tr", {}, h("th", {}, "API"), h("th", { class: "num" }, "Calls"), h("th", { class: "num" }, "Input tokens"), h("th", { class: "num" }, "Output tokens"), h("th", { class: "num" }, "Estimated cost"))),
      h("tbody", {}, ...rows),
    ),
    h("p", { class: "small muted" }, "Counters are always on and never leave this machine. Prices per 1M tokens; TypeSafe pricing is unpublished, fill it in when known."),
    priceField("TypeSafe input $/1M", "typesafeInput"),
    priceField("TypeSafe output $/1M", "typesafeOutput"),
    priceField("LLM input $/1M", "llmInput"),
    priceField("LLM output $/1M", "llmOutput"),
    priceField("Tavily $/call", "tavilyPerCall"),
    h("div", { class: "row-actions" }, h("button", { class: "btn", onClick: () => void clearUsage().then(render) }, "Reset counters"), h("button", { class: "btn", onClick: () => void copyReport() }, "Copy feedback report")),
    h("p", { class: "small muted", id: "report-status" }),
  );
}

/** Redacted report (PRD L7): verdict counts and usage, no checked text unless the box is ticked. */
async function copyReport(): Promise<void> {
  const log = await usageLog();
  const include = (document.getElementById("include-text") as HTMLInputElement | null)?.checked ?? false;
  const history = await readHistory();
  const report = {
    build,
    settings: { hotkey: settings.hotkey, autoDeepCheck: settings.autoDeepCheck, helperOn: keysPresent.llm && !settings.helperDisabled, helperPreset: settings.llmPreset, model: settings.llmModel, caps: settings.caps },
    usage: log.byLaneAndStep(),
    checks: history.map((e) => ({ at: new Date(e.at).toISOString(), kind: e.fast.contentKind, signals: e.fast.signals, techniques: e.fast.techniques, level: e.fast.level, verdicts: e.deep?.counts, text: include ? e.text : undefined })),
  };
  await app.writeClipboard(JSON.stringify(report, null, 2));
  const el = document.getElementById("report-status");
  if (el) el.textContent = line("feedback_copied");
}

function render(): void {
  clear(root);
  const auto = h("input", { type: "checkbox", checked: settings.autoDeepCheck });
  auto.addEventListener("change", () => { settings.autoDeepCheck = (auto as HTMLInputElement).checked; void save(); });
  const hist = h("input", { type: "checkbox", checked: settings.historyOn });
  hist.addEventListener("change", () => { settings.historyOn = (hist as HTMLInputElement).checked; void save(); });
  const includeText = h("input", { type: "checkbox", id: "include-text" });
  const maxClaims = h("input", { type: "number", min: "1", max: "12", value: String(settings.caps.maxClaims) });
  maxClaims.addEventListener("change", () => { settings.caps.maxClaims = Number(maxClaims.value) || 6; void save(); });
  const maxPages = h("input", { type: "number", min: "1", max: "10", value: String(settings.caps.maxPagesPerClaim) });
  maxPages.addEventListener("change", () => { settings.caps.maxPagesPerClaim = Number(maxPages.value) || 4; void save(); });

  const hotkeyHuman = settings.hotkey.replace("CommandOrControl", "Ctrl").replace(/\+/g, " + ");
  root.append(
    h("div", { style: "display:flex;justify-content:space-between;align-items:center" },
      h("h1", {}, h("img", { src: mascotUrl, alt: "" }), "Callout settings"),
      h("button", { class: "btn", onClick: () => void app.closeSettings() }, "Close"),
    ),
    keysPresent.typesafe
      ? h("div", { class: "card", style: "border-color: var(--accent)" },
          h("h2", {}, "You're set"),
          h("p", {}, "Highlight any text in any app and press ", h("kbd", {}, hotkeyHuman), ". Or copy a link and press it. Or click the Callout tray icon to check whatever is on the clipboard."),
          h("p", { class: "small muted" }, keysPresent.tavily ? "Web search is on." : "No Tavily key: claims are checked only against links in the text.", " ", keysPresent.llm && !settings.helperDisabled ? "Helper is on." : "No helper: no screenshots, summaries, or questions."),
          h("div", { class: "row-actions" },
            h("button", { class: "btn primary", onClick: () => void app.tryNow() }, "Try it now on the clipboard"),
            h("button", { class: "btn", onClick: () => void app.closeSettings() }, "Close settings"),
          ),
        )
      : h("div", { class: "card", style: "border-color: var(--amber)" },
          h("h2", {}, "One key to start"),
          h("p", {}, "Paste your TypeSafe key below and press Test and save. That is enough for the fast lane. The other two keys are optional and can wait."),
        ),
    h("p", { class: "joke" }, line("settings_intro")),
    h("div", { class: "card" },
      h("h2", {}, "Privacy"),
      h("p", { class: "small" }, "Text you check goes only to the three services you configure here (TypeSafe, your LLM provider, Tavily) and to the pages Callout fetches to find evidence. There is no Callout server, no account, and no telemetry. Usage counters stay on this machine."),
    ),
    keyCard("typesafe"),
    keyCard("tavily"),
    keyCard("llm"),
    h("div", { class: "card" },
      h("h2", {}, "Behaviour"),
      h("div", { class: "field" }, h("label", {}, "Hotkey"), hotkeyField()),
      h("label", { class: "toggle" }, auto, " Start the deep check automatically when the fast lane says it is worth it"),
      h("label", { class: "toggle" }, hist, " Keep local history (off by default). ", h("span", { class: "muted small" }, line("settings_history"))),
      h("div", { class: "row-actions" }, h("button", { class: "btn", onClick: () => void clearHistory() }, "Clear history")),
      h("div", { class: "field" }, h("label", {}, "Claims per check"), maxClaims),
      h("div", { class: "field" }, h("label", {}, "Pages per claim"), maxPages),
    ),
    h("div", { class: "card", id: "usage-card" }, h("p", { class: "muted" }, "Loading usage.")),
    h("div", { class: "card" },
      h("h2", {}, "Feedback"),
      h("label", { class: "toggle" }, includeText, " Include checked text in the report"),
      h("p", { class: "small muted" }, "The report has verdict counts, usage, and this build number. Paste it into the feedback form."),
      h("p", { class: "small muted" }, `Build ${build.version} (${build.build}) on ${build.platform}.`),
    ),
  );
  void usageTable().then((node) => {
    const card = document.getElementById("usage-card");
    if (card) card.replaceWith(node);
  });
}

void (async () => {
  settings = await loadSettings();
  build = await app.buildInfo();
  keysPresent = {
    typesafe: !!(await secrets.get("typesafe")),
    tavily: !!(await secrets.get("tavily")),
    llm: !!(await secrets.get("llm")),
  };
  render();
})();
