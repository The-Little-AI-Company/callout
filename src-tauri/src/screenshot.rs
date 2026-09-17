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
struct Grab {
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

/// Called by the screenshot window once its script is listening.
pub fn send_image(app: &AppHandle) -> Result<(), String> {
    let grab = PENDING.lock().unwrap().clone();
    match grab {
        Some(g) => app.emit_to("screenshot", "callout://screenshot-image", &g).map_err(|e| format!("{e}")),
        None => Err("no screenshot pending".into()),
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
