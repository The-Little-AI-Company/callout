//! Selection capture (PRD F2): save the clipboard, send Ctrl+C to the
//! foreground app, read what arrived, restore the clipboard. If nothing new
//! arrived, the existing clipboard is the fallback.

use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use serde::Serialize;
use std::{thread, time::Duration};
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

#[derive(Serialize, Clone, Debug)]
pub struct Capture {
    pub text: String,
    /// "selection" | "clipboard" | "page"
    pub kind: String,
    pub url: Option<String>,
    pub title: Option<String>,
}

pub fn read_clipboard(app: &AppHandle) -> Result<String, String> {
    app.clipboard().read_text().map_err(|e| format!("{e}"))
}

pub fn write_clipboard(app: &AppHandle, text: &str) -> Result<(), String> {
    app.clipboard().write_text(text.to_string()).map_err(|e| format!("{e}"))
}

pub fn capture_selection(app: &AppHandle) -> Result<Capture, String> {
    let before = read_clipboard(app).unwrap_or_default();

    // Put a sentinel on the clipboard so an unchanged clipboard is detectable
    // even when the selection equals the previous clipboard contents.
    let sentinel = format!("\u{200B}callout-sentinel-{}", std::process::id());
    let _ = write_clipboard(app, &sentinel);

    simulate_copy()?;

    // Apps take a moment to service WM_COPY. Poll briefly.
    let mut after = String::new();
    for _ in 0..12 {
        thread::sleep(Duration::from_millis(25));
        if let Ok(t) = read_clipboard(app) {
            if t != sentinel {
                after = t;
                break;
            }
        }
    }

    // Restore the user's clipboard no matter what.
    let _ = write_clipboard(app, &before);

    let (text, kind) = if !after.trim().is_empty() {
        (after, "selection")
    } else {
        (before, "clipboard")
    };
    let kind = if is_bare_url(&text) { "page" } else { kind };
    Ok(Capture { url: if kind == "page" { Some(text.trim().to_string()) } else { None }, text, kind: kind.to_string(), title: None })
}

fn simulate_copy() -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("{e}"))?;
    // Release any held modifiers from the hotkey chord first so the app sees a clean Ctrl+C.
    for k in [Key::Shift, Key::Alt, Key::Meta] {
        let _ = enigo.key(k, Direction::Release);
    }
    enigo.key(Key::Control, Direction::Press).map_err(|e| format!("{e}"))?;
    enigo.key(Key::Unicode('c'), Direction::Click).map_err(|e| format!("{e}"))?;
    enigo.key(Key::Control, Direction::Release).map_err(|e| format!("{e}"))?;
    Ok(())
}

fn is_bare_url(s: &str) -> bool {
    let t = s.trim();
    (t.starts_with("http://") || t.starts_with("https://")) && !t.contains(char::is_whitespace)
}
