use std::sync::Mutex;

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

const RELEASE_API_URL: &str = "https://api.github.com/repos/lteawoo/TokenMeter/releases/latest";
const RELEASE_FALLBACK_URL: &str = "https://github.com/lteawoo/TokenMeter/releases/latest";
pub(crate) const APP_UPDATE_STATE_EVENT: &str = "app-update-state-changed";
pub(crate) const HOMEBREW_UPGRADE_COMMAND: &str = "brew update && brew upgrade --cask tokenmeter";
const AUTO_UPDATE_CHECK_COOLDOWN_MINUTES: i64 = 10;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AppUpdateStatus {
    Idle,
    Checking,
    Latest,
    UpdateAvailable,
    Offline,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateState {
    pub status: AppUpdateStatus,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_url: String,
    pub checked_at: Option<String>,
    pub message: Option<String>,
    pub homebrew_upgrade_command: String,
}

impl AppUpdateState {
    fn idle() -> Self {
        Self {
            status: AppUpdateStatus::Idle,
            current_version: env!("CARGO_PKG_VERSION").to_string(),
            latest_version: None,
            release_url: RELEASE_FALLBACK_URL.to_string(),
            checked_at: None,
            message: None,
            homebrew_upgrade_command: HOMEBREW_UPGRADE_COMMAND.to_string(),
        }
    }
}

pub struct AppUpdateStateStore {
    state: Mutex<AppUpdateState>,
}

impl Default for AppUpdateStateStore {
    fn default() -> Self {
        Self {
            state: Mutex::new(AppUpdateState::idle()),
        }
    }
}

#[derive(Deserialize)]
struct ReleaseResponse {
    tag_name: String,
    html_url: String,
}

fn normalize_version(value: &str) -> String {
    value.trim().trim_start_matches(['v', 'V']).to_string()
}

fn compare_versions(left: &str, right: &str) -> std::cmp::Ordering {
    let parse = |value: &str| {
        normalize_version(value)
            .split('.')
            .map(|segment| segment.parse::<u32>().unwrap_or(0))
            .collect::<Vec<_>>()
    };

    let left_parts = parse(left);
    let right_parts = parse(right);
    let max_len = left_parts.len().max(right_parts.len());

    for index in 0..max_len {
        let left_part = *left_parts.get(index).unwrap_or(&0);
        let right_part = *right_parts.get(index).unwrap_or(&0);
        match left_part.cmp(&right_part) {
            std::cmp::Ordering::Equal => {}
            ordering => return ordering,
        }
    }

    std::cmp::Ordering::Equal
}

fn checked_at_now() -> String {
    Utc::now().to_rfc3339()
}

fn checked_at_is_recent(value: &Option<String>) -> bool {
    let Some(value) = value.as_ref() else {
        return false;
    };

    let Ok(parsed) = DateTime::parse_from_rfc3339(value) else {
        return false;
    };

    let checked_at = parsed.with_timezone(&Utc);
    Utc::now().signed_duration_since(checked_at) < Duration::minutes(AUTO_UPDATE_CHECK_COOLDOWN_MINUTES)
}

fn set_state<R: Runtime>(app: &AppHandle<R>, next_state: AppUpdateState) -> Result<(), String> {
    let store = app.state::<AppUpdateStateStore>();
    {
        let mut state = store.state.lock().map_err(|error| error.to_string())?;
        *state = next_state.clone();
    }

    app.emit(APP_UPDATE_STATE_EVENT, &next_state)
        .map_err(|error| error.to_string())
}

fn current_state<R: Runtime>(app: &AppHandle<R>) -> Result<AppUpdateState, String> {
    let store = app.state::<AppUpdateStateStore>();
    let state = store.state.lock().map_err(|error| error.to_string())?;
    Ok(state.clone())
}

pub fn get_update_state<R: Runtime>(app: &AppHandle<R>) -> Result<AppUpdateState, String> {
    current_state(app)
}

pub async fn check_for_updates<R: Runtime>(
    app: &AppHandle<R>,
    force: bool,
) -> Result<AppUpdateState, String> {
    let previous = current_state(app)?;
    if previous.status == AppUpdateStatus::Checking {
        return Ok(previous);
    }

    if !force && checked_at_is_recent(&previous.checked_at) {
        return Ok(previous);
    }

    let checking = AppUpdateState {
        status: AppUpdateStatus::Checking,
        checked_at: previous.checked_at.clone(),
        message: None,
        ..previous.clone()
    };
    set_state(app, checking)?;

    let client = reqwest::Client::builder()
        .user_agent(format!(
            "TokenMeter/{} (+https://github.com/lteawoo/TokenMeter)",
            env!("CARGO_PKG_VERSION")
        ))
        .build()
        .map_err(|error| error.to_string())?;

    let result = async {
        let response = client
            .get(RELEASE_API_URL)
            .send()
            .await
            .map_err(|error| error.to_string())?;
        let response = response
            .error_for_status()
            .map_err(|error| error.to_string())?;
        response
            .json::<ReleaseResponse>()
            .await
            .map_err(|error| error.to_string())
    }
    .await;

    let next_state = match result {
        Ok(release) => {
            let latest_version = normalize_version(&release.tag_name);
            let status = if compare_versions(&latest_version, env!("CARGO_PKG_VERSION"))
                == std::cmp::Ordering::Greater
            {
                AppUpdateStatus::UpdateAvailable
            } else {
                AppUpdateStatus::Latest
            };

            AppUpdateState {
                status,
                current_version: env!("CARGO_PKG_VERSION").to_string(),
                latest_version: Some(latest_version),
                release_url: if release.html_url.is_empty() {
                    RELEASE_FALLBACK_URL.to_string()
                } else {
                    release.html_url
                },
                checked_at: Some(checked_at_now()),
                message: None,
                homebrew_upgrade_command: HOMEBREW_UPGRADE_COMMAND.to_string(),
            }
        }
        Err(error) => AppUpdateState {
            status: AppUpdateStatus::Offline,
            checked_at: Some(checked_at_now()),
            message: Some(error),
            ..previous
        },
    };

    set_state(app, next_state.clone())?;
    Ok(next_state)
}

#[cfg(test)]
mod tests {
    use super::{checked_at_is_recent, compare_versions, normalize_version};
    use chrono::{Duration, Utc};

    #[test]
    fn normalizes_leading_v_prefix() {
        assert_eq!(normalize_version("v1.2.3"), "1.2.3");
        assert_eq!(normalize_version("V0.1.2"), "0.1.2");
    }

    #[test]
    fn compares_semver_like_values() {
        assert_eq!(
            compare_versions("0.1.2", "0.1.2"),
            std::cmp::Ordering::Equal
        );
        assert_eq!(
            compare_versions("0.2.0", "0.1.9"),
            std::cmp::Ordering::Greater
        );
        assert_eq!(compare_versions("1.0.0", "1.0.1"), std::cmp::Ordering::Less);
    }

    #[test]
    fn recent_checked_at_respects_cooldown_window() {
        let recent = Some((Utc::now() - Duration::minutes(5)).to_rfc3339());
        let stale = Some((Utc::now() - Duration::minutes(15)).to_rfc3339());

        assert!(checked_at_is_recent(&recent));
        assert!(!checked_at_is_recent(&stale));
        assert!(!checked_at_is_recent(&None));
    }
}
