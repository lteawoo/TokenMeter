use crate::codex;
use crate::settings::{self, AppSettings};
use crate::updates;
use tauri::{AppHandle, Emitter, Runtime};

#[tauri::command]
pub fn get_codex_overview<R: Runtime>(
    app: AppHandle<R>,
    limit: Option<usize>,
) -> Result<codex::CodexOverview, String> {
    codex::get_codex_overview(&app, codex::clamp_limit(limit))
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn show_dashboard_window<R: Runtime>(app: AppHandle<R>, openSettings: Option<bool>) {
    crate::show_dashboard_window(&app, openSettings.unwrap_or(false));
}

#[tauri::command]
pub fn get_app_settings<R: Runtime>(app: AppHandle<R>) -> Result<AppSettings, String> {
    settings::load_app_settings(&app)
}

#[tauri::command]
pub fn save_app_settings<R: Runtime>(
    app: AppHandle<R>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let saved = settings::save_app_settings(&app, settings)?;
    if let Err(error) = crate::refresh_tray_from_source(&app) {
        log::warn!("failed to refresh tray status after saving settings: {error}");
    }
    app.emit("app-settings-updated", &saved)
        .map_err(|error| error.to_string())?;
    Ok(saved)
}

#[tauri::command]
pub fn get_app_update_state<R: Runtime>(
    app: AppHandle<R>,
) -> Result<updates::AppUpdateState, String> {
    updates::get_update_state(&app)
}

#[tauri::command]
pub async fn check_for_app_updates<R: Runtime>(
    app: AppHandle<R>,
    force: Option<bool>,
) -> Result<updates::AppUpdateState, String> {
    updates::check_for_updates(&app, force.unwrap_or(false)).await
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    crate::open_external_url(&url)
}
