use std::{
    env, fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

const SETTINGS_FILE_NAME: &str = "settings.json";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ThemeMode {
    System,
    Dark,
    Light,
}

impl Default for ThemeMode {
    fn default() -> Self {
        Self::Dark
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TrayMetricMode {
    FiveHour,
    Weekly,
    Both,
}

impl Default for TrayMetricMode {
    fn default() -> Self {
        Self::Weekly
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TrayPresentationMode {
    IconAndText,
    TextOnly,
}

impl Default for TrayPresentationMode {
    fn default() -> Self {
        Self::TextOnly
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_codex_root_path_string")]
    pub codex_root_path: String,
    #[serde(default)]
    pub theme_mode: ThemeMode,
    #[serde(default)]
    pub tray_metric_mode: TrayMetricMode,
    #[serde(default)]
    pub tray_presentation_mode: TrayPresentationMode,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            codex_root_path: default_codex_root_path_string(),
            theme_mode: ThemeMode::default(),
            tray_metric_mode: TrayMetricMode::default(),
            tray_presentation_mode: TrayPresentationMode::default(),
        }
    }
}

fn default_codex_root_path() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("~"))
        .join(".codex")
        .join("sessions")
}

fn default_codex_root_path_string() -> String {
    default_codex_root_path().display().to_string()
}

fn settings_file_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    Ok(config_dir.join(SETTINGS_FILE_NAME))
}

fn expand_home_path(value: &str) -> Result<PathBuf, String> {
    if value == "~" {
        return env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| "HOME is not set.".to_string());
    }

    if let Some(suffix) = value.strip_prefix("~/") {
        let home = env::var_os("HOME").ok_or_else(|| "HOME is not set.".to_string())?;
        return Ok(PathBuf::from(home).join(suffix));
    }

    Ok(PathBuf::from(value))
}

pub fn validate_codex_root_path(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Codex root path is required.".into());
    }

    let expanded = expand_home_path(trimmed)?;
    let canonical = expanded
        .canonicalize()
        .map_err(|_| "Codex root path must point to an existing directory.".to_string())?;

    if !canonical.is_dir() {
        return Err("Codex root path must point to a directory.".into());
    }

    Ok(canonical.display().to_string())
}

fn sanitize_loaded_settings(settings: AppSettings) -> AppSettings {
    let codex_root_path = validate_codex_root_path(&settings.codex_root_path)
        .unwrap_or_else(|_| default_codex_root_path_string());

    AppSettings {
        codex_root_path,
        tray_presentation_mode: TrayPresentationMode::TextOnly,
        ..settings
    }
}

fn normalize_settings_for_save(settings: AppSettings) -> Result<AppSettings, String> {
    Ok(AppSettings {
        codex_root_path: validate_codex_root_path(&settings.codex_root_path)?,
        tray_presentation_mode: TrayPresentationMode::TextOnly,
        ..settings
    })
}

fn load_settings_from_path(path: &Path) -> Result<AppSettings, String> {
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let parsed = serde_json::from_str::<AppSettings>(&contents).unwrap_or_default();
    Ok(sanitize_loaded_settings(parsed))
}

fn save_settings_to_path(path: &Path, settings: &AppSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let payload = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(path, payload).map_err(|error| error.to_string())
}

pub fn load_app_settings<R: Runtime>(app: &AppHandle<R>) -> Result<AppSettings, String> {
    load_settings_from_path(&settings_file_path(app)?)
}

pub fn save_app_settings<R: Runtime>(
    app: &AppHandle<R>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let normalized = normalize_settings_for_save(settings)?;
    save_settings_to_path(&settings_file_path(app)?, &normalized)?;
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::{
        default_codex_root_path_string, load_settings_from_path, save_settings_to_path,
        validate_codex_root_path, AppSettings, ThemeMode, TrayMetricMode, TrayPresentationMode,
    };
    use std::{
        env, fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn unique_temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time works")
            .as_nanos();
        let path = env::temp_dir().join(format!("tokenmeter-{name}-{unique}"));
        fs::create_dir_all(&path).expect("temp dir should be created");
        path
    }

    #[test]
    fn validate_codex_root_path_rejects_missing_dir() {
        let missing = env::temp_dir().join("tokenmeter-missing-dir");
        let result = validate_codex_root_path(&missing.display().to_string());

        assert!(result.is_err());
    }

    #[test]
    fn save_and_load_settings_round_trip() {
        let root = unique_temp_dir("codex-root");
        let settings_file = unique_temp_dir("settings").join("settings.json");
        let settings = AppSettings {
            codex_root_path: root
                .canonicalize()
                .expect("temp dir should canonicalize")
                .display()
                .to_string(),
            theme_mode: ThemeMode::Light,
            tray_metric_mode: TrayMetricMode::Both,
            tray_presentation_mode: TrayPresentationMode::TextOnly,
        };

        save_settings_to_path(&settings_file, &settings).expect("settings should save");
        let loaded = load_settings_from_path(&settings_file).expect("settings should load");

        assert_eq!(loaded, settings);
    }

    #[test]
    fn load_settings_falls_back_to_default_root_when_saved_root_is_invalid() {
        let settings_file = unique_temp_dir("fallback").join("settings.json");
        let invalid = AppSettings {
            codex_root_path: "/definitely/invalid/tokenmeter/root".into(),
            theme_mode: ThemeMode::Dark,
            tray_metric_mode: TrayMetricMode::Weekly,
            tray_presentation_mode: TrayPresentationMode::IconAndText,
        };

        save_settings_to_path(&settings_file, &invalid).expect("invalid fixture should write");
        let loaded = load_settings_from_path(&settings_file).expect("settings should load");

        assert_eq!(loaded.codex_root_path, default_codex_root_path_string());
    }
}
