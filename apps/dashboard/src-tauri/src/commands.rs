use crate::codex;

#[tauri::command]
pub fn get_codex_overview(limit: Option<usize>) -> Result<codex::CodexOverview, String> {
  codex::get_codex_overview(codex::clamp_limit(limit))
}
