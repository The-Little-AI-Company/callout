/**
 * Builds engine clients from settings and secrets. One place decides which
 * lanes are available: fast lane needs TypeSafe; search needs Tavily; the
 * helper needs an LLM key and the helper switch on.
 */
import { JevClient, type JevJudge } from "@engine/jev/client";
import { LlmClient, PRESETS, type LlmHelper } from "@engine/helper/llm";
import { TavilyClient, type SearchClient } from "@engine/deeplane/search";
import { PageFetcher } from "@engine/fetch/readable";
import { UsageLog } from "@engine/usage";
import type { UsageEntry } from "@engine/types";
import { httpFetch, kv, secrets } from "./tauri";
import { loadSettings, type Settings } from "./settings";
import { questions } from "./content";

export interface Engine {
  settings: Settings;
  usage: UsageLog;
  jev?: JevJudge;
  llm?: LlmHelper;
  search?: SearchClient;
  fetcher: PageFetcher;
  online: boolean;
  missing: { typesafe: boolean; tavily: boolean; llm: boolean };
}

let usageLog: UsageLog | undefined;

/** Usage persists across sessions (PRD F19), capped to the last 5000 entries. */
export async function usage(): Promise<UsageLog> {
  if (usageLog) return usageLog;
  const store = await kv();
  const initial = (await store.get<UsageEntry[]>("usage")) ?? [];
  let pending: UsageEntry[] = initial;
  let timer: ReturnType<typeof setTimeout> | undefined;
  usageLog = new UsageLog(
    {
      append(entry) {
        pending = [...pending.slice(-4999), entry];
        clearTimeout(timer);
        timer = setTimeout(() => void store.set("usage", pending), 500);
      },
    },
    initial,
  );
  return usageLog;
}

export async function clearUsage(): Promise<void> {
  const store = await kv();
  await store.set("usage", []);
  usageLog?.clear();
}

const parseHtml = (html: string): Document => new DOMParser().parseFromString(html, "text/html");

const pageCache = new Map();

export async function buildEngine(): Promise<Engine> {
  const settings = await loadSettings();
  const log = await usage();
  const [typesafeKey, tavilyKey, llmKey] = await Promise.all([secrets.get("typesafe"), secrets.get("tavily"), secrets.get("llm")]);

  const jev = typesafeKey ? new JevClient({ apiKey: typesafeKey, usage: log, fetch: httpFetch as never, model: questions.model }) : undefined;
  const search = tavilyKey ? new TavilyClient(tavilyKey, httpFetch as never, log) : undefined;
  const llm = settings.helperOn && llmKey ? new LlmClient(llmConfig(settings, llmKey), httpFetch as never, log) : undefined;
  const fetcher = new PageFetcher({ fetch: httpFetch as never, parseHtml, cache: pageCache });

  return {
    settings,
    usage: log,
    jev,
    llm,
    search,
    fetcher,
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    missing: { typesafe: !typesafeKey, tavily: !tavilyKey, llm: !llmKey },
  };
}

export function llmConfig(settings: Settings, apiKey: string) {
  const preset = settings.llmPreset === "custom" ? undefined : PRESETS[settings.llmPreset];
  return {
    wire: preset?.wire ?? settings.llmWire,
    baseURL: settings.llmBaseURL || preset?.baseURL || "",
    model: settings.llmModel || preset?.model || "",
    explainModel: settings.llmExplainModel || undefined,
    apiKey,
    thinking: "off" as const,
  };
}
