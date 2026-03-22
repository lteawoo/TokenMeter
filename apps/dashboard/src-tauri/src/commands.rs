use crate::codex;
use crate::settings::{self, AppSettings, TrayPresentationMode};
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
  app
    .emit("app-settings-updated", &saved)
    .map_err(|error| error.to_string())?;
  Ok(saved)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn sync_tray_status<R: Runtime>(
  app: AppHandle<R>,
  statusText: Option<String>,
  trayPresentationMode: TrayPresentationMode,
) -> Result<(), String> {
  crate::sync_tray_status(&app, statusText, trayPresentationMode).map_err(|error| error.to_string())
}
