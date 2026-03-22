use crate::codex;
use tauri::{AppHandle, Runtime};

#[tauri::command]
pub fn get_codex_overview(limit: Option<usize>) -> Result<codex::CodexOverview, String> {
  codex::get_codex_overview(codex::clamp_limit(limit))
}

#[tauri::command]
pub fn show_dashboard_window<R: Runtime>(app: AppHandle<R>) {
  crate::show_dashboard_window(&app);
}
