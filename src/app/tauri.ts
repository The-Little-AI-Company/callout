/**
 * Thin bridge to Tauri. Everything here degrades to browser equivalents when
 * the page is opened in a plain browser (`npm run dev`), so the popover can be
 * developed without a Windows build. Secrets are not available in the browser.
 */
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, emit as tauriEmit, type UnlistenFn } from "@tauri-apps/api/event";
import { fetch as pluginFetch } from "@tauri-apps/plugin-http";
import { openUrl as pluginOpenUrl } from "@tauri-apps/plugin-opener";
import { load as loadStore, type Store } from "@tauri-apps/plugin-store";
import type { CaptureSource } from "@engine/types";

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type SecretName = "typesafe" | "tavily" | "llm";

export interface CapturePayload {
  text: string;
  kind: CaptureSource["kind"];
  url?: string;
  title?: string;
}

export interface ScreenshotPayload {
  /** PNG, base64, already cropped to the selected region. */
  png: string;
}

export interface BuildInfo {
  version: string;
  build: string;
  platform: string;
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error(`${cmd} needs the desktop app`);
  return tauriInvoke<T>(cmd, args);
}

export async function listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri()) {
    const h = (e: Event) => handler((e as CustomEvent<T>).detail);
    window.addEventListener(event, h);
    return () => window.removeEventListener(event, h);
  }
  return tauriListen<T>(event, (e) => handler(e.payload));
}

export async function emit(event: string, payload?: unknown): Promise<void> {
  if (!isTauri()) {
    window.dispatchEvent(new CustomEvent(event, { detail: payload }));
    return;
  }
  await tauriEmit(event, payload);
}

/** HTTP through the Rust side (no CORS). Falls back to the browser fetch in dev. */
export const httpFetch: typeof globalThis.fetch = (input, init) => (isTauri() ? pluginFetch(input as string, init) : globalThis.fetch(input, init));

export async function openUrl(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  await pluginOpenUrl(url);
}

// Secrets (PRD F16): Windows Credential Manager through Rust `keyring`.
export const secrets = {
  async get(name: SecretName): Promise<string | null> {
    if (!isTauri()) return sessionStorage.getItem(`dev-secret:${name}`);
    return invoke<string | null>("get_secret", { name });
  },
  async set(name: SecretName, value: string): Promise<void> {
    if (!isTauri()) {
      sessionStorage.setItem(`dev-secret:${name}`, value);
      return;
    }
    await invoke("set_secret", { name, value });
  },
  async delete(name: SecretName): Promise<void> {
    if (!isTauri()) {
      sessionStorage.removeItem(`dev-secret:${name}`);
      return;
    }
    await invoke("delete_secret", { name });
  },
};

// Non-secret settings and usage: JSON store on disk, localStorage in dev.
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

let storePromise: Promise<KeyValueStore> | undefined;

export function kv(): Promise<KeyValueStore> {
  if (!storePromise) storePromise = isTauri() ? openTauriStore() : Promise.resolve(localStore());
  return storePromise;
}

async function openTauriStore(): Promise<KeyValueStore> {
  const store: Store = await loadStore("callout.json", { autoSave: 300 as never, defaults: {} });
  return {
    get: <T>(key: string) => store.get<T>(key),
    set: (key, value) => store.set(key, value),
    delete: async (key) => {
      await store.delete(key);
    },
  };
}

function localStore(): KeyValueStore {
  return {
    async get<T>(key: string) {
      const v = localStorage.getItem(`callout:${key}`);
      return v === null ? undefined : (JSON.parse(v) as T);
    },
    async set(key, value) {
      localStorage.setItem(`callout:${key}`, JSON.stringify(value));
    },
    async delete(key) {
      localStorage.removeItem(`callout:${key}`);
    },
  };
}

// Window commands.
export const app = {
  hidePopover: () => (isTauri() ? invoke<void>("hide_popover") : Promise.resolve()),
  openSettings: () => (isTauri() ? invoke<void>("open_settings") : Promise.resolve(void window.open("/settings.html", "_blank"))),
  captureSelection: () => invoke<CapturePayload>("capture_selection"),
  readClipboard: () => invoke<string>("read_clipboard"),
  startScreenshot: () => invoke<void>("start_screenshot"),
  setHotkey: (accelerator: string) => invoke<void>("set_hotkey", { accelerator }),
  buildInfo: async (): Promise<BuildInfo> => (isTauri() ? invoke<BuildInfo>("build_info") : { version: "dev", build: "browser", platform: "browser" }),
  resizePopover: (height: number) => (isTauri() ? invoke<void>("resize_popover", { height: Math.round(height) }) : Promise.resolve()),
  tryNow: () => (isTauri() ? invoke<void>("try_now") : Promise.resolve()),
  closeSettings: () => (isTauri() ? invoke<void>("close_settings") : Promise.resolve(window.close())),
  writeClipboard: (text: string) => (isTauri() ? invoke<void>("write_clipboard", { text }) : navigator.clipboard.writeText(text)),
};
