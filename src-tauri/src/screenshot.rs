//! Region screenshot (PRD F4b). Grab the monitor under the cursor with xcap
//! on a worker thread, write it to the app cache as PNG, then open a
//! borderless full-screen window over that monitor. The webview loads the
//! file through the asset protocol (no multi-megabyte IPC payload), lets the
//! user drag a rectangle, crops with a canvas, and sends the small cropped
//! PNG to the popover. This module never sees the crop or the helper.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

#[derive(Serialize, Clone)]
pub struct Grab {
    /// Absolute path of the PNG in the app cache dir.
    path: String,
    width: u32,
    height: u32,
    scale: f64,
}

static PENDING: Mutex<Option<Grab>> = Mutex::new(None);

pub fn start(app: &AppHandle) -> Result<(), String> {
    if let Some(p) = app.get_webview_window("popover") {
        let _ = p.hide();
    }
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = grab_and_open(&app) {
            log::warn!("screenshot failed: {e}");
            let _ = app.emit_to("popover", "callout://screenshot-error", &e);
            let _ = crate::windows::show_popover_at_cursor(&app);
        }
    });
    Ok(())
}

fn grab_and_open(app: &AppHandle) -> Result<(), String> {
    // Let the popover finish hiding so it is not in the grab.
    std::thread::sleep(std::time::Duration::from_millis(150));

    let cursor = app.cursor_position().map_err(|e| format!("{e}"))?;
    let monitor = xcap::Monitor::from_point(cursor.x as i32, cursor.y as i32).map_err(|e| format!("{e}"))?;
    let img = monitor.capture_image().map_err(|e| format!("{e}"))?;
    let (w, h) = (img.width(), img.height());

    let dir = app.path().app_cache_dir().map_err(|e| format!("{e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("{e}"))?;
    let path = dir.join("callout-screen.png");
    img.save_with_format(&path, image::ImageFormat::Png).map_err(|e| format!("{e}"))?;

    let scale = monitor.scale_factor().map_err(|e| format!("{e}"))? as f64;
    let x = monitor.x().map_err(|e| format!("{e}"))?;
    let y = monitor.y().map_err(|e| format!("{e}"))?;
    let mw = monitor.width().map_err(|e| format!("{e}"))?;
    let mh = monitor.height().map_err(|e| format!("{e}"))?;
    *PENDING.lock().unwrap() = Some(Grab { path: path.to_string_lossy().into_owned(), width: w, height: h, scale });

    // Windows must be created on the main thread.
    let app2 = app.clone();
    app.run_on_main_thread(move || {
        if let Err(e) = open_window(&app2, x, y, mw, mh) {
            log::warn!("screenshot window: {e}");
        }
    })
    .map_err(|e| format!("{e}"))
}

fn open_window(app: &AppHandle, x: i32, y: i32, mw: u32, mh: u32) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("screenshot") {
        let _ = existing.close();
    }
    let win = WebviewWindowBuilder::new(app, "screenshot", WebviewUrl::App("screenshot.html".into()))
        .title("Select a region")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .build()
        .map_err(|e| format!("{e}"))?;
    win.set_position(PhysicalPosition::new(x, y)).map_err(|e| format!("{e}"))?;
    win.set_size(PhysicalSize::new(mw, mh)).map_err(|e| format!("{e}"))?;
    win.show().map_err(|e| format!("{e}"))?;
    win.set_focus().map_err(|e| format!("{e}"))?;
    Ok(())
}

/// Called by the screenshot window once its script runs. Returns the grab
/// directly (no event race).
pub fn pending() -> Result<Grab, String> {
    PENDING.lock().unwrap().clone().ok_or_else(|| "no screenshot pending".to_string())
}

/// Fallback when the asset protocol cannot serve the file: the PNG as a data URL.
pub fn data_url() -> Result<String, String> {
    use base64::Engine as _;
    let g = pending()?;
    let bytes = std::fs::read(&g.path).map_err(|e| format!("{e}"))?;
    Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[derive(serde::Deserialize)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Serialize, Clone)]
struct Crop {
    png: String,
}

/// Crop the pending grab in Rust (the webview canvas is tainted by the
/// asset-protocol image), send the crop to the popover, close the overlay,
/// bring the popover back. Always closes the overlay, even on error.
pub fn finish(app: &AppHandle, rect: Rect) -> Result<(), String> {
    use base64::Engine as _;
    let result = (|| -> Result<String, String> {
        let g = pending()?;
        let mut img = image::open(&g.path).map_err(|e| format!("{e}"))?;
        let x = rect.x.min(g.width.saturating_sub(1));
        let y = rect.y.min(g.height.saturating_sub(1));
        let w = rect.w.max(1).min(g.width - x);
        let h = rect.h.max(1).min(g.height - y);
        let crop = img.crop(x, y, w, h);
        let mut buf = Vec::new();
        crop.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png).map_err(|e| format!("{e}"))?;
        Ok(base64::engine::general_purpose::STANDARD.encode(buf))
    })();
    let _ = close(app);
    let _ = crate::windows::show_popover_at_cursor(app);
    match result {
        Ok(png) => app.emit_to("popover", "callout://screenshot", &Crop { png }).map_err(|e| format!("{e}")),
        Err(e) => {
            let _ = app.emit_to("popover", "callout://screenshot-error", &e);
            Err(e)
        }
    }
}

pub fn close(app: &AppHandle) -> Result<(), String> {
    if let Some(g) = PENDING.lock().unwrap().take() {
        let _ = std::fs::remove_file(g.path);
    }
    if let Some(w) = app.get_webview_window("screenshot") {
        w.close().map_err(|e| format!("{e}"))?;
    }
    Ok(())
}
