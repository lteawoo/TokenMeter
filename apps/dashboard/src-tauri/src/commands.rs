use crate::codex;
use crate::settings::{self, AppSettings};
use crate::updates;
use tauri::{AppHandle, Emitter, Runtime};

fn finalize_saved_settings<RefreshTray, EmitUpdate>(
    saved: AppSettings,
    refresh_tray: RefreshTray,
    emit_update: EmitUpdate,
) -> AppSettings
where
    RefreshTray: FnOnce() -> Result<(), String>,
    EmitUpdate: FnOnce(&AppSettings) -> Result<(), String>,
{
    if let Err(error) = refresh_tray() {
        log::warn!("failed to refresh tray status after saving settings: {error}");
    }

    if let Err(error) = emit_update(&saved) {
        log::warn!("failed to emit app settings update after saving settings: {error}");
    }

    saved
}

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
    Ok(finalize_saved_settings(
        saved,
        || crate::refresh_tray_from_source(&app).map_err(|error| error.to_string()),
        |saved| {
            app.emit("app-settings-updated", saved)
                .map_err(|error| error.to_string())
        },
    ))
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

#[cfg(test)]
mod tests {
    use super::{finalize_saved_settings, save_app_settings};
    use crate::settings::{
        self, AppSettings, ThemeMode, TrayMetricMode, TrayPresentationMode,
    };
    use std::{
        env, fs,
        path::{Path, PathBuf},
        sync::Mutex,
        time::{SystemTime, UNIX_EPOCH},
    };

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn sample_settings() -> AppSettings {
        AppSettings {
            codex_root_path: "/tmp/.codex".to_string(),
            theme_mode: ThemeMode::Dark,
            tray_metric_mode: TrayMetricMode::Weekly,
            tray_presentation_mode: TrayPresentationMode::TextOnly,
        }
    }

    fn unique_temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time works")
            .as_nanos();
        let path = env::temp_dir().join(format!("tokenmeter-{name}-{unique}"));
        fs::create_dir_all(&path).expect("temp dir should be created");
        path
    }

    fn create_codex_root(base_dir: &Path) -> PathBuf {
        let codex_root = base_dir.join(".codex");
        fs::create_dir_all(codex_root.join("sessions"))
            .expect("codex sessions dir should be created");
        codex_root
    }

    struct EnvVarGuard {
        key: &'static str,
        previous: Option<String>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: &Path) -> Self {
            let previous = env::var(key).ok();
            // SAFETY: tests serialize environment mutation with ENV_LOCK.
            unsafe {
                env::set_var(key, value);
            }

            Self { key, previous }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            // SAFETY: tests serialize environment mutation with ENV_LOCK.
            unsafe {
                match &self.previous {
                    Some(value) => env::set_var(self.key, value),
                    None => env::remove_var(self.key),
                }
            }
        }
    }

    #[test]
    fn finalize_saved_settings_returns_saved_when_emit_fails() {
        let saved = sample_settings();

        let finalized = finalize_saved_settings(
            saved.clone(),
            || Ok(()),
            |_| Err("emit failed".to_string()),
        );

        assert_eq!(finalized, saved);
    }

    #[test]
    fn finalize_saved_settings_returns_saved_when_refresh_fails() {
        let saved = sample_settings();

        let finalized = finalize_saved_settings(
            saved.clone(),
            || Err("refresh failed".to_string()),
            |_| Ok(()),
        );

        assert_eq!(finalized, saved);
    }

    #[test]
    fn save_app_settings_persists_and_returns_saved_settings() {
        let _env_lock = ENV_LOCK.lock().expect("env lock should be available");
        let temp_home = unique_temp_dir("commands-save-settings-home");
        let _home_guard = EnvVarGuard::set("HOME", &temp_home);
        let _xdg_guard = EnvVarGuard::set("XDG_CONFIG_HOME", &temp_home.join(".config"));
        let codex_root = create_codex_root(&temp_home);
        let canonical_codex_root = codex_root
            .canonicalize()
            .expect("codex root should canonicalize");
        let app = tauri::test::mock_app();

        let saved = save_app_settings(
            app.handle().clone(),
            AppSettings {
                codex_root_path: canonical_codex_root.display().to_string(),
                theme_mode: ThemeMode::Light,
                tray_metric_mode: TrayMetricMode::FiveHour,
                tray_presentation_mode: TrayPresentationMode::IconAndText,
            },
        )
        .expect("settings should save");

        assert_eq!(
            saved,
            AppSettings {
                codex_root_path: canonical_codex_root.display().to_string(),
                theme_mode: ThemeMode::Light,
                tray_metric_mode: TrayMetricMode::FiveHour,
                tray_presentation_mode: TrayPresentationMode::TextOnly,
            }
        );
        assert_eq!(
            settings::load_app_settings(&app.handle()).expect("settings should load"),
            saved
        );

        fs::remove_dir_all(temp_home).expect("temp home should be removed");
    }
}
