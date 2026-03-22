use std::{process::Command, thread, time::Duration};

mod codex;
mod commands;
mod settings;
mod updates;

use serde::Serialize;
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Position, Runtime, Size,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const DASHBOARD_WINDOW_LABEL: &str = "dashboard";
const TRAY_ID: &str = "tokenmeter-tray";
const MENU_OPEN_DASHBOARD: &str = "open-dashboard";
const MENU_REFRESH_DASHBOARD: &str = "refresh-dashboard";
const MENU_CHECK_FOR_UPDATES: &str = "check-for-updates";
const MENU_QUIT_APP: &str = "quit-app";
const PANEL_WIDTH: f64 = 352.0;
const PANEL_HEIGHT: f64 = 332.0;
const PANEL_OFFSET_Y: f64 = 10.0;
const TRAY_REFRESH_INTERVAL_SECS: u64 = 5;
const DESKTOP_WINDOW_VISIBILITY_EVENT: &str = "desktop-window-visibility-changed";

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopWindowVisibilityPayload {
    view: &'static str,
    visible: bool,
}

fn main_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
}

fn dashboard_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(DASHBOARD_WINDOW_LABEL)
}

fn configure_main_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = main_window(app) else {
        return;
    };

    let _ = window.set_decorations(false);
    let _ = window.set_always_on_top(true);
    let _ = window.set_skip_taskbar(true);
    let _ = window.set_shadow(true);
    let _ = window.set_size(LogicalSize::new(PANEL_WIDTH, PANEL_HEIGHT));
    let _ = window.hide();

    if let Ok(mut url) = window.url() {
        if url.query() != Some("view=panel") {
            url.set_query(Some("view=panel"));
            let _ = window.navigate(url);
        }
    }
}

fn emit_window_visibility<R: Runtime>(app: &AppHandle<R>, view: &'static str, visible: bool) {
    let _ = app.emit(
        DESKTOP_WINDOW_VISIBILITY_EVENT,
        DesktopWindowVisibilityPayload { view, visible },
    );
}

pub(crate) fn show_dashboard_window<R: Runtime>(app: &AppHandle<R>, open_settings: bool) {
    let target_url = if open_settings {
        "index.html?view=dashboard&settings=1"
    } else {
        "index.html?view=dashboard"
    };

    if let Some(window) = dashboard_window(app) {
        if let Ok(mut url) = window.url() {
            if url.path().ends_with("index.html")
                || url.scheme() == "tauri"
                || url.scheme() == "http"
                || url.scheme() == "https"
            {
                url.set_query(Some(if open_settings {
                    "view=dashboard&settings=1"
                } else {
                    "view=dashboard"
                }));
                let _ = window.navigate(url);
            }
        }
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        emit_window_visibility(app, "dashboard", true);
        return;
    }

    let Ok(window) = WebviewWindowBuilder::new(
        app,
        DASHBOARD_WINDOW_LABEL,
        WebviewUrl::App(target_url.into()),
    )
    .title("TokenMeter")
    .inner_size(1200.0, 820.0)
    .min_inner_size(960.0, 680.0)
    .resizable(true)
    .focused(true)
    .build() else {
        return;
    };

    let _ = window.show();
    let _ = window.set_focus();
    emit_window_visibility(app, "dashboard", true);
}

fn toggle_or_show_main_window_at_tray<R: Runtime>(
    app: &AppHandle<R>,
    tray_position: Position,
    tray_size: Size,
) {
    let Some(window) = main_window(app) else {
        return;
    };

    let is_visible = window.is_visible().unwrap_or(false);
    let is_focused = window.is_focused().unwrap_or(false);
    if is_visible && is_focused {
        let _ = window.hide();
        emit_window_visibility(app, "panel", false);
        return;
    }

    let _ = window.set_size(LogicalSize::new(PANEL_WIDTH, PANEL_HEIGHT));

    let outer_size = window.outer_size().ok();
    let window_width = outer_size
        .map(|size| size.width as f64)
        .unwrap_or(PANEL_WIDTH);

    let (tray_x, tray_y) = match tray_position {
        Position::Physical(position) => (position.x, position.y),
        Position::Logical(position) => (position.x as i32, position.y as i32),
    };
    let (tray_width, tray_height) = match tray_size {
        Size::Physical(size) => (size.width, size.height),
        Size::Logical(size) => (size.width as u32, size.height as u32),
    };

    let x =
        (f64::from(tray_x) + (f64::from(tray_width) / 2.0) - (window_width / 2.0)).round() as i32;
    let y = (f64::from(tray_y) + f64::from(tray_height) + PANEL_OFFSET_Y).round() as i32;

    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.show();
    let _ = window.set_focus();
    emit_window_visibility(app, "panel", true);
}

pub(crate) fn refresh_tray_from_source<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let app_settings = settings::load_app_settings(app).unwrap_or_default();
    let status_text = codex::get_codex_overview(app, codex::clamp_limit(None))
        .ok()
        .and_then(|overview| codex::format_tray_status(&overview, app_settings.tray_metric_mode));

    sync_tray_status(app, status_text, app_settings.tray_presentation_mode)
}

pub(crate) fn open_external_url(url: &str) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only http:// and https:// URLs are allowed.".to_string());
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", url]);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };

    command.spawn().map_err(|error| error.to_string())?;
    Ok(())
}

fn start_tray_refresh_loop<R: Runtime + 'static>(app: AppHandle<R>) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(TRAY_REFRESH_INTERVAL_SECS));
        let _ = refresh_tray_from_source(&app);
    });
}

pub(crate) fn sync_tray_status<R: Runtime>(
    app: &AppHandle<R>,
    status_text: Option<String>,
    _tray_presentation_mode: settings::TrayPresentationMode,
) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };

    tray.set_icon(None)?;

    tray.set_title(status_text.clone())?;
    tray.set_tooltip(
        status_text
            .as_ref()
            .map(|value| format!("TokenMeter · {value}"))
            .or_else(|| Some("TokenMeter".to_string())),
    )?;

    Ok(())
}

fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text(MENU_OPEN_DASHBOARD, "Open Dashboard")
        .text(MENU_REFRESH_DASHBOARD, "Refresh Tray")
        .separator()
        .text(MENU_CHECK_FOR_UPDATES, "Check for Updates")
        .separator()
        .text(MENU_QUIT_APP, "Quit TokenMeter")
        .build()?;

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("TokenMeter")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().0.as_str() {
            MENU_OPEN_DASHBOARD => show_dashboard_window(app, false),
            MENU_REFRESH_DASHBOARD => {
                let _ = refresh_tray_from_source(app);
            }
            MENU_CHECK_FOR_UPDATES => {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = updates::check_for_updates(&app_handle, true).await;
                });
            }
            MENU_QUIT_APP => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                rect,
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_or_show_main_window_at_tray(tray.app_handle(), rect.position, rect.size);
            }
        });

    tray.build(app)?;
    refresh_tray_from_source(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(updates::AppUpdateStateStore::default())
        .on_window_event(|window, event| match (window.label(), event) {
            (MAIN_WINDOW_LABEL, WindowEvent::Focused(false)) => {
                emit_window_visibility(window.app_handle(), "panel", false);
                let _ = window.hide();
            }
            (MAIN_WINDOW_LABEL, WindowEvent::Focused(true)) => {
                emit_window_visibility(window.app_handle(), "panel", true);
            }
            (DASHBOARD_WINDOW_LABEL, WindowEvent::Focused(focused)) => {
                emit_window_visibility(window.app_handle(), "dashboard", *focused);
            }
            _ => {}
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            configure_main_window(&app.handle());
            build_tray(&app.handle())?;
            start_tray_refresh_loop(app.handle().clone());
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = updates::check_for_updates(&app_handle, false).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_codex_overview,
            commands::show_dashboard_window,
            commands::get_app_settings,
            commands::save_app_settings,
            commands::get_app_update_state,
            commands::check_for_app_updates,
            commands::open_external_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::TRAY_REFRESH_INTERVAL_SECS;

    #[test]
    fn tray_refresh_interval_is_five_seconds() {
        assert_eq!(TRAY_REFRESH_INTERVAL_SECS, 5);
    }
}
