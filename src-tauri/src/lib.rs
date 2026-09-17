//! Callout desktop shell. Everything that needs the OS lives here:
//! tray icon, global hotkey, selection capture through a simulated copy,
//! clipboard restore, the credential store, window placement, and the
//! full-monitor grab for region screenshots. All judgment runs in the
//! webview engine; this crate never sees an API key's use.

mod capture;
mod secrets;
mod screenshot;
mod windows;

use serde::Serialize;
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const SERVICE: &str = "callout";
const DEFAULT_HOTKEY: &str = "CommandOrControl+Shift+Space";

#[derive(Default)]
pub struct AppState {
    hotkey: Mutex<Option<Shortcut>>,
    /// When pinned, the popover stays open on focus loss.
    pinned: AtomicBool,
}

#[derive(Serialize, Clone)]
pub struct BuildInfo {
    version: String,
    build: String,
    platform: String,
}

#[tauri::command]
fn build_info() -> BuildInfo {
    BuildInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        build: option_env!("CALLOUT_BUILD").unwrap_or("local").to_string(),
        platform: std::env::consts::OS.to_string(),
    }
}

#[tauri::command]
fn get_secret(name: String) -> Result<Option<String>, String> {
    secrets::get(SERVICE, &name)
}

#[tauri::command]
fn set_secret(name: String, value: String) -> Result<(), String> {
    secrets::set(SERVICE, &name, &value)
}

#[tauri::command]
fn delete_secret(name: String) -> Result<(), String> {
    secrets::delete(SERVICE, &name)
}

#[tauri::command]
fn capture_selection(app: AppHandle) -> Result<capture::Capture, String> {
    capture::capture_selection(&app)
}

#[tauri::command]
fn read_clipboard(app: AppHandle) -> Result<String, String> {
    capture::read_clipboard(&app)
}

#[tauri::command]
fn write_clipboard(app: AppHandle, text: String) -> Result<(), String> {
    capture::write_clipboard(&app, &text)
}

#[tauri::command]
fn hide_popover(app: AppHandle) -> Result<(), String> {
    windows::hide_popover(&app)
}

#[tauri::command]
fn resize_popover(app: AppHandle, height: u32) -> Result<(), String> {
    windows::resize_popover(&app, height)
}

#[tauri::command]
fn open_settings(app: AppHandle) -> Result<(), String> {
    windows::open_settings(&app)
}

#[tauri::command]
fn set_hotkey(app: AppHandle, state: State<'_, AppState>, accelerator: String) -> Result<(), String> {
    register_hotkey(&app, &state, &accelerator)
}

#[tauri::command]
fn start_screenshot(app: AppHandle) -> Result<(), String> {
    screenshot::start(&app)
}

#[tauri::command]
fn screenshot_ready() -> Result<screenshot::Grab, String> {
    screenshot::pending()
}

#[tauri::command]
fn screenshot_data_url() -> Result<String, String> {
    screenshot::data_url()
}

#[tauri::command]
fn screenshot_done(app: AppHandle, rect: screenshot::Rect) -> Result<(), String> {
    screenshot::finish(&app, rect)
}

#[tauri::command]
fn close_screenshot(app: AppHandle) -> Result<(), String> {
    screenshot::close(&app)
}

/// Settings "Try it now": same path as the hotkey, so the popover opens with
/// whatever is on the clipboard.
#[tauri::command]
fn try_now(app: AppHandle) {
    on_hotkey(app);
}

#[tauri::command]
fn set_pinned(state: State<'_, AppState>, pinned: bool) {
    state.pinned.store(pinned, Ordering::Relaxed);
}

#[tauri::command]
fn close_settings(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("settings") {
        w.close().map_err(|e| format!("{e}"))?;
    }
    Ok(())
}

fn register_hotkey(app: &AppHandle, state: &AppState, accelerator: &str) -> Result<(), String> {
    let shortcut: Shortcut = accelerator.parse().map_err(|e| format!("{e}"))?;
    let gs = app.global_shortcut();
    if let Some(old) = state.hotkey.lock().unwrap().take() {
        let _ = gs.unregister(old);
    }
    gs.register(shortcut).map_err(|e| format!("{e}"))?;
    *state.hotkey.lock().unwrap() = Some(shortcut);
    log::info!("hotkey registered: {accelerator}");
    Ok(())
}

/// The hotkey path: capture, place the popover near the cursor, show it,
/// then hand the text to the webview. Runs off the main thread so the
/// simulated copy never blocks the event loop.
fn on_hotkey(app: AppHandle) {
    std::thread::spawn(move || {
        let capture = match capture::capture_selection(&app) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("capture failed: {e}");
                capture::Capture { text: String::new(), kind: "clipboard".into(), url: None, title: None }
            }
        };
        if let Err(e) = windows::show_popover_at_cursor(&app) {
            log::warn!("show popover: {e}");
        }
        if let Err(e) = app.emit_to("popover", "callout://capture", &capture) {
            log::warn!("emit capture: {e}");
        }
    });
}

fn saved_hotkey(app: &AppHandle) -> String {
    // The settings JSON store is owned by the frontend; read the file directly
    // once at startup so the hotkey works before any window loads.
    let path = app.path().app_data_dir().ok().map(|d| d.join("callout.json"));
    let Some(path) = path else { return DEFAULT_HOTKEY.into() };
    let Ok(raw) = std::fs::read_to_string(path) else { return DEFAULT_HOTKEY.into() };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else { return DEFAULT_HOTKEY.into() };
    json.get("settings")
        .and_then(|s| s.get("hotkey"))
        .and_then(|h| h.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| DEFAULT_HOTKEY.into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        // Must be the first plugin: a second launch (Start menu, installer
        // relaunch) hands off to the running instance and exits, so there is
        // never a second tray icon.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            on_hotkey(app.clone());
        }))
        .manage(AppState::default())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        on_hotkey(app.clone());
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            build_info,
            get_secret,
            set_secret,
            delete_secret,
            capture_selection,
            read_clipboard,
            write_clipboard,
            hide_popover,
            resize_popover,
            open_settings,
            set_hotkey,
            start_screenshot,
            screenshot_ready,
            screenshot_data_url,
            screenshot_done,
            close_screenshot,
            try_now,
            close_settings,
            set_pinned,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Tray: left click opens the popover, menu has settings and quit.
            let check = MenuItem::with_id(app, "check", "Check clipboard", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Callout", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&check, &settings, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Callout")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "check" => on_hotkey(app.clone()),
                    "settings" => {
                        let _ = windows::open_settings(app);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. } = event {
                        on_hotkey(tray.app_handle().clone());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // Hotkey from saved settings, falling back to the default.
            let accel = saved_hotkey(&handle);
            let state: State<AppState> = handle.state();
            if let Err(e) = register_hotkey(&handle, &state, &accel) {
                log::error!("could not register {accel}: {e}; trying default");
                let _ = register_hotkey(&handle, &state, DEFAULT_HOTKEY);
            }

            // First run: no TypeSafe key yet, open settings.
            if secrets::get(SERVICE, "typesafe").ok().flatten().is_none() {
                let _ = windows::open_settings(&handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the popover hides it; the app lives in the tray.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "popover" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            if let tauri::WindowEvent::Focused(false) = event {
                if window.label() == "popover" {
                    let pinned = window.app_handle().state::<AppState>().pinned.load(Ordering::Relaxed);
                    if !pinned {
                        // Never call window APIs synchronously inside the event callback.
                        let w = window.clone();
                        std::thread::spawn(move || {
                            let _ = w.hide();
                        });
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Callout");
}
