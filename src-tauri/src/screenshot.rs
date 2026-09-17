//! Region screenshot (PRD F4b). Grab the monitor under the cursor with xcap,
//! open a borderless full-screen window over it, and let the webview do the
//! rectangle selection and crop. The cropped PNG goes to the helper's vision
//! model from the popover; this module never sees it.

use base64::Engine as _;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

#[derive(Serialize, Clone)]
struct Grab {
    png: String,
    width: u32,
    height: u32,
    scale: f64,
}

static PENDING: Mutex<Option<Grab>> = Mutex::new(None);

pub fn start(app: &AppHandle) -> Result<(), String> {
    // Hide the popover so it is not in the grab.
    if let Some(p) = app.get_webview_window("popover") {
        let _ = p.hide();
    }
    std::thread::sleep(std::time::Duration::from_millis(120));

    let cursor = app.cursor_position().map_err(|e| format!("{e}"))?;
    let monitor = xcap::Monitor::from_point(cursor.x as i32, cursor.y as i32).map_err(|e| format!("{e}"))?;
    let img = monitor.capture_image().map_err(|e| format!("{e}"))?;
    let (w, h) = (img.width(), img.height());
    let mut buf = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png).map_err(|e| format!("{e}"))?;
    let png = base64::engine::general_purpose::STANDARD.encode(&buf);
    let scale = monitor.scale_factor().map_err(|e| format!("{e}"))? as f64;
    *PENDING.lock().unwrap() = Some(Grab { png, width: w, height: h, scale });

    let x = monitor.x().map_err(|e| format!("{e}"))?;
    let y = monitor.y().map_err(|e| format!("{e}"))?;
    let mw = monitor.width().map_err(|e| format!("{e}"))?;
    let mh = monitor.height().map_err(|e| format!("{e}"))?;

    if let Some(existing) = app.get_webview_window("screenshot") {
        let _ = existing.close();
    }
    let win = WebviewWindowBuilder::new(app, "screenshot", WebviewUrl::App("screenshot.html".into()))
        .title("Select a region")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
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
    *PENDING.lock().unwrap() = None;
    if let Some(w) = app.get_webview_window("screenshot") {
        w.close().map_err(|e| format!("{e}"))?;
    }
    Ok(())
}
