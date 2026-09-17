//! Window placement. The popover is frameless, always on top, and appears
//! near the cursor, clamped to the monitor the cursor is on.

use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

pub const POPOVER_WIDTH: f64 = 380.0;
const MARGIN: i32 = 12;

pub fn popover(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("popover").ok_or_else(|| "popover window missing".to_string())
}

pub fn show_popover_at_cursor(app: &AppHandle) -> Result<(), String> {
    let win = popover(app)?;
    let cursor = app.cursor_position().map_err(|e| format!("{e}"))?;
    let monitor = app
        .monitor_from_point(cursor.x, cursor.y)
        .map_err(|e| format!("{e}"))?
        .or_else(|| app.primary_monitor().ok().flatten());
    let size = win.outer_size().map_err(|e| format!("{e}"))?;
    let (mut x, mut y) = (cursor.x as i32 + MARGIN, cursor.y as i32 + MARGIN);
    if let Some(m) = monitor {
        let pos = m.position();
        let dim = m.size();
        let max_x = pos.x + dim.width as i32 - size.width as i32 - MARGIN;
        let max_y = pos.y + dim.height as i32 - size.height as i32 - MARGIN;
        x = x.min(max_x).max(pos.x + MARGIN);
        y = y.min(max_y).max(pos.y + MARGIN);
    }
    win.set_position(PhysicalPosition::new(x, y)).map_err(|e| format!("{e}"))?;
    win.show().map_err(|e| format!("{e}"))?;
    win.set_focus().map_err(|e| format!("{e}"))?;
    Ok(())
}

pub fn hide_popover(app: &AppHandle) -> Result<(), String> {
    popover(app)?.hide().map_err(|e| format!("{e}"))
}

pub fn resize_popover(app: &AppHandle, height: u32) -> Result<(), String> {
    let win = popover(app)?;
    let h = (height.max(80).min(640)) as f64;
    win.set_size(LogicalSize::new(POPOVER_WIDTH, h)).map_err(|e| format!("{e}"))
}

/// Opening a window from inside an event-loop callback (tray menu, IPC
/// command on the main thread) can deadlock on Windows. Hand the build to
/// the main loop from a worker thread so it runs in its own iteration.
pub fn open_settings(app: &AppHandle) -> Result<(), String> {
    let _ = hide_popover(app);
    let app = app.clone();
    std::thread::spawn(move || {
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Err(e) = build_settings(&app2) {
                log::warn!("settings window: {e}");
            }
        });
    });
    Ok(())
}

fn build_settings(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("settings") {
        w.show().map_err(|e| format!("{e}"))?;
        w.unminimize().map_err(|e| format!("{e}"))?;
        w.set_focus().map_err(|e| format!("{e}"))?;
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
        .title("Callout settings")
        .inner_size(760.0, 820.0)
        .min_inner_size(520.0, 400.0)
        .build()
        .map_err(|e| format!("{e}"))?;
    Ok(())
}
