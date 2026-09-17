/**
 * Region selection over a full-monitor grab. Rust sends the PNG; the user
 * drags a rectangle; the crop is emitted to the popover as base64 PNG.
 */
import { h } from "../dom";
import { emit, invoke, isTauri } from "../app/tauri";
import { convertFileSrc } from "@tauri-apps/api/core";

interface Grab {
  /** Absolute path of the full-monitor PNG written by Rust. */
  path: string;
  width: number;
  height: number;
  scale: number;
}

const root = document.getElementById("app")!;
let grab: Grab | undefined;
let start: { x: number; y: number } | undefined;
const rect = h("div", { class: "rect", style: "display:none" });
const img = h("img", { alt: "" });
root.append(img, h("div", { class: "veil" }), rect, h("div", { class: "hint" }, "Drag to select. Esc cancels."));

function cancel(): void {
  if (isTauri()) void invoke("close_screenshot");
  else window.close();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") cancel();
});

root.addEventListener("mousedown", (e) => {
  start = { x: e.clientX, y: e.clientY };
  Object.assign(rect.style, { display: "block", left: `${e.clientX}px`, top: `${e.clientY}px`, width: "0px", height: "0px" });
});

root.addEventListener("mousemove", (e) => {
  if (!start) return;
  const x = Math.min(start.x, e.clientX);
  const y = Math.min(start.y, e.clientY);
  Object.assign(rect.style, { left: `${x}px`, top: `${y}px`, width: `${Math.abs(e.clientX - start.x)}px`, height: `${Math.abs(e.clientY - start.y)}px` });
});

root.addEventListener("mouseup", async (e) => {
  if (!start || !grab) return;
  const x = Math.min(start.x, e.clientX);
  const y = Math.min(start.y, e.clientY);
  const w = Math.abs(e.clientX - start.x);
  const hgt = Math.abs(e.clientY - start.y);
  start = undefined;
  if (w < 8 || hgt < 8) return;
  const sx = grab.width / window.innerWidth;
  const sy = grab.height / window.innerHeight;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * sx);
  canvas.height = Math.round(hgt * sy);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, x * sx, y * sy, w * sx, hgt * sy, 0, 0, canvas.width, canvas.height);
  const png = canvas.toDataURL("image/png").split(",")[1] ?? "";
  await emit("callout://screenshot", { png });
  if (isTauri()) await invoke("screenshot_done");
  else window.close();
});

const hint = root.querySelector(".hint") as HTMLElement;

async function loadGrab(): Promise<void> {
  if (!isTauri()) return;
  try {
    grab = await invoke<Grab>("screenshot_ready");
  } catch (e) {
    hint.textContent = `Screenshot failed: ${String(e)}. Press Esc.`;
    return;
  }
  // Try the asset protocol first (no big payload); fall back to a data URL.
  img.onerror = async () => {
    img.onerror = () => {
      hint.textContent = "Could not load the screenshot. Press Esc.";
    };
    try {
      img.src = await invoke<string>("screenshot_data_url");
    } catch (e) {
      hint.textContent = `Could not load the screenshot: ${String(e)}. Press Esc.`;
    }
  };
  img.src = convertFileSrc(grab.path);
}

void loadGrab();
