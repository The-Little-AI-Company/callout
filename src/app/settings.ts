/**
 * Non-secret settings (PRD F17). Keys live in the credential store, not here.
 */
import { kv } from "./tauri";

export interface Settings {
  hotkey: string;
  autoDeepCheck: boolean;
  historyOn: boolean;
  helperOn: boolean;
  llmPreset: "deepseek" | "deepseek_anthropic" | "openai_compatible" | "anthropic" | "custom";
  llmWire: "openai" | "anthropic";
  llmBaseURL: string;
  llmModel: string;
  llmExplainModel: string;
  caps: { maxClaims: number; maxPagesPerClaim: number };
  /** Price per 1M tokens the user fills in once known (PRD F19). */
  prices: { typesafeInput: number; typesafeOutput: number; llmInput: number; llmOutput: number; tavilyPerCall: number };
  setupDone: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  hotkey: "CommandOrControl+Shift+Space",
  autoDeepCheck: true,
  historyOn: false,
  helperOn: false,
  llmPreset: "deepseek",
  llmWire: "openai",
  llmBaseURL: "https://api.deepseek.com",
  llmModel: "deepseek-flash",
  llmExplainModel: "",
  caps: { maxClaims: 6, maxPagesPerClaim: 4 },
  prices: { typesafeInput: 0, typesafeOutput: 0, llmInput: 0.15, llmOutput: 0.6, tavilyPerCall: 0 },
  setupDone: false,
};

export async function loadSettings(): Promise<Settings> {
  const store = await kv();
  const saved = await store.get<Partial<Settings>>("settings");
  return { ...DEFAULT_SETTINGS, ...saved, caps: { ...DEFAULT_SETTINGS.caps, ...saved?.caps }, prices: { ...DEFAULT_SETTINGS.prices, ...saved?.prices } };
}

export async function saveSettings(s: Settings): Promise<void> {
  const store = await kv();
  await store.set("settings", s);
}
