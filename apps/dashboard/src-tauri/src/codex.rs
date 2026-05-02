use std::{
    collections::{BTreeMap, HashMap, HashSet},
    env,
    fs::{self, DirEntry, File},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use chrono::{DateTime, Duration, Local, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime};

use crate::settings;

const DEFAULT_LIMIT: usize = 12;
const MIN_LIMIT: usize = 1;
const MAX_LIMIT: usize = 25;
const SESSION_FILE_INDEX_FILE_NAME: &str = "codex-session-file-index.json";
const SESSION_SUMMARY_CACHE_FILE_NAME: &str = "codex-session-summary-cache.json";
const SESSION_SUMMARY_CACHE_VERSION: u32 = 4;
const SESSION_FILE_INDEX_VERSION: u32 = 1;
const PREFERRED_PLAN_LIMIT_ID: &str = "codex";
const DEFAULT_DAILY_WINDOW_DAYS: i64 = 30;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTotals {
    input_tokens: u64,
    cached_input_tokens: u64,
    output_tokens: u64,
    reasoning_output_tokens: u64,
    total_tokens: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitSnapshot {
    used_percent: f64,
    window_minutes: Option<u64>,
    resets_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionSummary {
    id: String,
    file_path: String,
    file_name: String,
    model: Option<String>,
    effort: Option<String>,
    cwd: Option<String>,
    updated_at: String,
    total_usage: Option<UsageTotals>,
    last_usage: Option<UsageTotals>,
    primary_rate_limit: Option<RateLimitSnapshot>,
    secondary_rate_limit: Option<RateLimitSnapshot>,
    status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsageSummary {
    date: String,
    cwd: Option<String>,
    file_path: Option<String>,
    session_count: u64,
    usage: UsageTotals,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSessionSummary {
    id: String,
    file_path: String,
    file_name: String,
    model: Option<String>,
    effort: Option<String>,
    cwd: Option<String>,
    updated_at: String,
    total_usage: Option<UsageTotals>,
    last_usage: Option<UsageTotals>,
    primary_rate_limit: Option<RateLimitSnapshot>,
    secondary_rate_limit: Option<RateLimitSnapshot>,
    daily_usage: Vec<DailyUsageSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexOverview {
    provider: String,
    generated_at: String,
    sessions_dir: String,
    latest_session: Option<CodexSessionSummary>,
    sessions: Vec<CodexSessionSummary>,
    daily_usage: Vec<DailyUsageSummary>,
    totals: UsageTotals,
    last_turn_totals: UsageTotals,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedSessionSummary {
    path: String,
    modified_unix_ms: u64,
    size_bytes: u64,
    summary: StoredSessionSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionSummaryCache {
    version: u32,
    sessions_dir: String,
    entries: Vec<CachedSessionSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionFileIndex {
    version: u32,
    sessions_dir: String,
    directories: Vec<TrackedDirectorySnapshot>,
    files: Vec<SessionFileSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TrackedDirectorySnapshot {
    path: String,
    modified_unix_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionFileSnapshot {
    path: PathBuf,
    modified_unix_ms: u64,
    size_bytes: u64,
}

impl StoredSessionSummary {
    fn empty(file_path: &Path) -> Self {
        let file_name = file_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();

        Self {
            id: file_name.trim_end_matches(".jsonl").to_string(),
            file_path: file_path.display().to_string(),
            file_name,
            model: None,
            effort: None,
            cwd: None,
            updated_at: DateTime::<Utc>::from(std::time::UNIX_EPOCH)
                .to_rfc3339_opts(SecondsFormat::Millis, true),
            total_usage: None,
            last_usage: None,
            primary_rate_limit: None,
            secondary_rate_limit: None,
            daily_usage: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
struct SessionTreeInventory {
    directories: Vec<TrackedDirectorySnapshot>,
    files: Vec<SessionFileSnapshot>,
}

fn default_codex_sessions_dir() -> Result<PathBuf, String> {
    let home = env::var_os("HOME").ok_or_else(|| "HOME is not set".to_string())?;
    Ok(PathBuf::from(home).join(".codex").join("sessions"))
}

fn codex_sessions_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let settings = settings::load_app_settings(app)?;
    Ok(settings::resolve_codex_sessions_dir(&PathBuf::from(
        settings.codex_root_path,
    )))
}

fn session_summary_cache_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .or_else(|_| app.path().app_config_dir())
        .map(|dir| dir.join(SESSION_SUMMARY_CACHE_FILE_NAME))
        .map_err(|error| error.to_string())
}

fn session_file_index_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .or_else(|_| app.path().app_config_dir())
        .map(|dir| dir.join(SESSION_FILE_INDEX_FILE_NAME))
        .map_err(|error| error.to_string())
}

fn new_session_summary_cache(sessions_dir: &Path) -> SessionSummaryCache {
    SessionSummaryCache {
        version: SESSION_SUMMARY_CACHE_VERSION,
        sessions_dir: sessions_dir.display().to_string(),
        entries: Vec::new(),
    }
}

#[cfg(test)]
fn new_session_file_index(sessions_dir: &Path) -> SessionFileIndex {
    SessionFileIndex {
        version: SESSION_FILE_INDEX_VERSION,
        sessions_dir: sessions_dir.display().to_string(),
        directories: Vec::new(),
        files: Vec::new(),
    }
}

fn load_session_summary_cache(path: &Path, sessions_dir: &Path) -> SessionSummaryCache {
    if !path.exists() {
        return new_session_summary_cache(sessions_dir);
    }

    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) => {
            log::warn!("failed to read session summary cache: {error}");
            return new_session_summary_cache(sessions_dir);
        }
    };

    let cache = match serde_json::from_str::<SessionSummaryCache>(&contents) {
        Ok(cache) => cache,
        Err(error) => {
            log::warn!("failed to decode session summary cache: {error}");
            return new_session_summary_cache(sessions_dir);
        }
    };

    if cache.version != SESSION_SUMMARY_CACHE_VERSION
        || cache.sessions_dir != sessions_dir.display().to_string()
    {
        return new_session_summary_cache(sessions_dir);
    }

    cache
}

fn load_session_file_index(path: &Path, sessions_dir: &Path) -> Option<SessionFileIndex> {
    if !path.exists() {
        return None;
    }

    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) => {
            log::warn!("failed to read session file index: {error}");
            return None;
        }
    };

    let index = match serde_json::from_str::<SessionFileIndex>(&contents) {
        Ok(index) => index,
        Err(error) => {
            log::warn!("failed to decode session file index: {error}");
            return None;
        }
    };

    if index.version != SESSION_FILE_INDEX_VERSION
        || index.sessions_dir != sessions_dir.display().to_string()
    {
        return None;
    }

    Some(index)
}

fn save_session_summary_cache(path: &Path, cache: &SessionSummaryCache) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let payload = serde_json::to_string_pretty(cache).map_err(|error| error.to_string())?;
    fs::write(path, payload).map_err(|error| error.to_string())
}

fn session_status_from_updated_at(updated_at: &str, now: DateTime<Utc>) -> String {
    let updated = DateTime::parse_from_rfc3339(updated_at)
        .map(|value| value.with_timezone(&Utc))
        .unwrap_or_else(|_| DateTime::<Utc>::from(std::time::UNIX_EPOCH));
    let is_active = now.signed_duration_since(updated).num_minutes() < 15;

    if is_active {
        "active".into()
    } else {
        "idle".into()
    }
}

fn save_session_file_index(path: &Path, index: &SessionFileIndex) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let payload = serde_json::to_string_pretty(index).map_err(|error| error.to_string())?;
    fs::write(path, payload).map_err(|error| error.to_string())
}

pub fn clamp_limit(limit: Option<usize>) -> usize {
    limit.unwrap_or(DEFAULT_LIMIT).clamp(MIN_LIMIT, MAX_LIMIT)
}

fn remaining_percent(snapshot: Option<&RateLimitSnapshot>) -> Option<u64> {
    snapshot.map(|value| (100_i64 - value.used_percent.round() as i64).max(0) as u64)
}

pub fn format_tray_status(
    overview: &CodexOverview,
    tray_metric_mode: settings::TrayMetricMode,
) -> Option<String> {
    let latest_session = overview.latest_session.as_ref();
    let five_hour_remaining =
        remaining_percent(latest_session.and_then(|session| session.primary_rate_limit.as_ref()));
    let weekly_remaining =
        remaining_percent(latest_session.and_then(|session| session.secondary_rate_limit.as_ref()));

    match tray_metric_mode {
        settings::TrayMetricMode::FiveHour => {
            five_hour_remaining.map(|value| format!("5H {value}"))
        }
        settings::TrayMetricMode::Weekly => weekly_remaining.map(|value| format!("W {value}")),
        settings::TrayMetricMode::Both => {
            let parts = [
                five_hour_remaining.map(|value| format!("5H {value}")),
                weekly_remaining.map(|value| format!("W {value}")),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();

            (!parts.is_empty()).then(|| parts.join(" "))
        }
    }
}

fn modified_unix_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis()
        .try_into()
        .ok()
}

fn recursive_session_tree_inventory(dir: &Path) -> SessionTreeInventory {
    let mut inventory = SessionTreeInventory {
        directories: Vec::new(),
        files: Vec::new(),
    };

    let Ok(metadata) = fs::metadata(dir) else {
        return inventory;
    };
    let Some(dir_modified_unix_ms) = modified_unix_ms(&metadata) else {
        return inventory;
    };

    inventory.directories.push(TrackedDirectorySnapshot {
        path: dir.display().to_string(),
        modified_unix_ms: dir_modified_unix_ms,
    });

    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return inventory,
    };

    for entry in entries {
        let entry: DirEntry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();

        if path.is_dir() {
            let nested = recursive_session_tree_inventory(&path);
            inventory.directories.extend(nested.directories);
            inventory.files.extend(nested.files);
        } else if path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value == "jsonl")
        {
            let Ok(metadata) = fs::metadata(&path) else {
                continue;
            };
            let Some(file_modified_unix_ms) = modified_unix_ms(&metadata) else {
                continue;
            };

            inventory.files.push(SessionFileSnapshot {
                path,
                modified_unix_ms: file_modified_unix_ms,
                size_bytes: metadata.len(),
            });
        }
    }

    inventory
}

fn recursive_jsonl_file_snapshots(dir: &Path) -> Vec<SessionFileSnapshot> {
    recursive_session_tree_inventory(dir).files
}

fn usage_from_value(value: &Value) -> Option<UsageTotals> {
    if !value.is_object() {
        return None;
    }

    Some(UsageTotals {
        input_tokens: value["input_tokens"].as_u64().unwrap_or(0),
        cached_input_tokens: value["cached_input_tokens"].as_u64().unwrap_or(0),
        output_tokens: value["output_tokens"].as_u64().unwrap_or(0),
        reasoning_output_tokens: value["reasoning_output_tokens"].as_u64().unwrap_or(0),
        total_tokens: value["total_tokens"].as_u64().unwrap_or(0),
    })
}

fn rate_limit_from_value(value: &Value) -> Option<RateLimitSnapshot> {
    if !value.is_object() {
        return None;
    }

    let resets_at = value["resets_at"]
        .as_i64()
        .and_then(|timestamp| DateTime::<Utc>::from_timestamp(timestamp, 0))
        .map(|value| value.to_rfc3339_opts(SecondsFormat::Secs, true));

    Some(RateLimitSnapshot {
        used_percent: value["used_percent"].as_f64().unwrap_or(0.0),
        window_minutes: value["window_minutes"].as_u64(),
        resets_at,
    })
}

fn should_replace_rate_limits(current_limit_id: Option<&str>, next_limit_id: Option<&str>) -> bool {
    if next_limit_id == Some(PREFERRED_PLAN_LIMIT_ID) {
        return true;
    }

    if current_limit_id == Some(PREFERRED_PLAN_LIMIT_ID) {
        return false;
    }

    true
}

fn add_usage(left: &mut UsageTotals, right: &Option<UsageTotals>) {
    if let Some(value) = right {
        add_usage_value(left, value);
    }
}

fn add_usage_value(left: &mut UsageTotals, right: &UsageTotals) {
    left.input_tokens += right.input_tokens;
    left.cached_input_tokens += right.cached_input_tokens;
    left.output_tokens += right.output_tokens;
    left.reasoning_output_tokens += right.reasoning_output_tokens;
    left.total_tokens += right.total_tokens;
}

fn usage_delta(current: &UsageTotals, previous: Option<&UsageTotals>) -> UsageTotals {
    let Some(previous) = previous else {
        return current.clone();
    };

    UsageTotals {
        input_tokens: current.input_tokens.saturating_sub(previous.input_tokens),
        cached_input_tokens: current
            .cached_input_tokens
            .saturating_sub(previous.cached_input_tokens),
        output_tokens: current.output_tokens.saturating_sub(previous.output_tokens),
        reasoning_output_tokens: current
            .reasoning_output_tokens
            .saturating_sub(previous.reasoning_output_tokens),
        total_tokens: current.total_tokens.saturating_sub(previous.total_tokens),
    }
}

fn local_date_from_timestamp(timestamp: Option<&str>, fallback: DateTime<Utc>) -> String {
    timestamp
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Local))
        .unwrap_or_else(|| fallback.with_timezone(&Local))
        .format("%Y-%m-%d")
        .to_string()
}

fn daily_usage_key(date: &str, cwd: &Option<String>, file_path: &str) -> (String, String) {
    (
        date.to_string(),
        cwd.clone().unwrap_or_else(|| file_path.to_string()),
    )
}

fn add_session_daily_usage(
    entries: &mut BTreeMap<(String, String), DailyUsageSummary>,
    date: String,
    cwd: Option<String>,
    file_path: &str,
    usage: UsageTotals,
) {
    let key = daily_usage_key(&date, &cwd, file_path);

    if let Some(existing) = entries.get_mut(&key) {
        add_usage_value(&mut existing.usage, &usage);
        return;
    }

    entries.insert(
        key,
        DailyUsageSummary {
            date,
            cwd: cwd.clone(),
            file_path: cwd.is_none().then(|| file_path.to_string()),
            session_count: 1,
            usage,
        },
    );
}

fn add_daily_usage_record(
    entries: &mut BTreeMap<(String, String), DailyUsageSummary>,
    record: &DailyUsageSummary,
) {
    let key = daily_usage_key(
        &record.date,
        &record.cwd,
        record.file_path.as_deref().unwrap_or_default(),
    );

    if let Some(existing) = entries.get_mut(&key) {
        existing.session_count += record.session_count;
        add_usage_value(&mut existing.usage, &record.usage);
        return;
    }

    entries.insert(key, record.clone());
}

fn enrich_session_summary(
    summary: StoredSessionSummary,
    now: DateTime<Utc>,
) -> CodexSessionSummary {
    let status = session_status_from_updated_at(&summary.updated_at, now);

    CodexSessionSummary {
        id: summary.id,
        file_path: summary.file_path,
        file_name: summary.file_name,
        model: summary.model,
        effort: summary.effort,
        cwd: summary.cwd,
        updated_at: summary.updated_at,
        total_usage: summary.total_usage,
        last_usage: summary.last_usage,
        primary_rate_limit: summary.primary_rate_limit,
        secondary_rate_limit: summary.secondary_rate_limit,
        status,
    }
}

fn parse_session_file(path: &Path) -> Result<StoredSessionSummary, String> {
    let mut summary = StoredSessionSummary::empty(path);
    let mut selected_rate_limit_id: Option<String> = None;
    let mut previous_total_usage: Option<UsageTotals> = None;
    let mut daily_usage_entries: BTreeMap<(String, String), DailyUsageSummary> = BTreeMap::new();
    let metadata = fs::metadata(path).map_err(|err| err.to_string())?;
    let modified = metadata.modified().map_err(|err| err.to_string())?;
    let fallback_updated_at = DateTime::<Utc>::from(modified);
    let file_path = path.display().to_string();
    let file = File::open(path).map_err(|err| err.to_string())?;
    let reader = BufReader::new(file);

    for line in reader.lines() {
        let line = line.map_err(|err| err.to_string())?;
        if line.trim().is_empty() {
            continue;
        }

        let event: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };

        if event["type"].as_str() == Some("turn_context") {
            let payload = &event["payload"];
            summary.cwd = payload["cwd"].as_str().map(str::to_string).or(summary.cwd);
            summary.model = payload["model"]
                .as_str()
                .map(str::to_string)
                .or(summary.model);
            summary.effort = payload["effort"]
                .as_str()
                .map(str::to_string)
                .or(summary.effort);
            summary.id = payload["turn_id"]
                .as_str()
                .map(str::to_string)
                .unwrap_or(summary.id);
        }

        if event["type"].as_str() == Some("event_msg")
            && event["payload"]["type"].as_str() == Some("token_count")
        {
            let info = &event["payload"]["info"];
            if let Some(total_usage) = usage_from_value(&info["total_token_usage"]) {
                let delta = usage_delta(&total_usage, previous_total_usage.as_ref());
                let date =
                    local_date_from_timestamp(event["timestamp"].as_str(), fallback_updated_at);
                add_session_daily_usage(
                    &mut daily_usage_entries,
                    date,
                    summary.cwd.clone(),
                    &file_path,
                    delta,
                );
                previous_total_usage = Some(total_usage.clone());
                summary.total_usage = Some(total_usage);
            }
            summary.last_usage = usage_from_value(&info["last_token_usage"]).or(summary.last_usage);
            let next_rate_limit_id = event["payload"]["rate_limits"]["limit_id"].as_str();
            if should_replace_rate_limits(selected_rate_limit_id.as_deref(), next_rate_limit_id) {
                selected_rate_limit_id = next_rate_limit_id.map(str::to_string);
                summary.primary_rate_limit =
                    rate_limit_from_value(&event["payload"]["rate_limits"]["primary"])
                        .or(summary.primary_rate_limit);
                summary.secondary_rate_limit =
                    rate_limit_from_value(&event["payload"]["rate_limits"]["secondary"])
                        .or(summary.secondary_rate_limit);
            }
            summary.updated_at = event["timestamp"]
                .as_str()
                .map(str::to_string)
                .unwrap_or(summary.updated_at);
        }
    }

    if summary.updated_at.starts_with("1970-01-01") {
        summary.updated_at = fallback_updated_at.to_rfc3339_opts(SecondsFormat::Millis, true);
    }

    summary.daily_usage = daily_usage_entries.into_values().collect();

    Ok(summary)
}

fn snapshot_path_key(snapshot: &SessionFileSnapshot) -> String {
    snapshot.path.display().to_string()
}

fn directory_path_key(snapshot: &TrackedDirectorySnapshot) -> String {
    snapshot.path.clone()
}

fn session_file_index_is_valid(index: &SessionFileIndex, sessions_dir: &Path) -> bool {
    if index.sessions_dir != sessions_dir.display().to_string() {
        return false;
    }

    let root = match fs::metadata(sessions_dir) {
        Ok(metadata) => metadata,
        Err(_) => return false,
    };
    let Some(root_modified_unix_ms) = modified_unix_ms(&root) else {
        return false;
    };

    let root_key = sessions_dir.display().to_string();
    let Some(root_entry) = index
        .directories
        .iter()
        .find(|entry| directory_path_key(entry) == root_key)
    else {
        return false;
    };

    if root_entry.modified_unix_ms != root_modified_unix_ms {
        return false;
    }

    for directory in &index.directories {
        let Ok(metadata) = fs::metadata(&directory.path) else {
            return false;
        };
        let Some(modified_unix_ms) = modified_unix_ms(&metadata) else {
            return false;
        };

        if modified_unix_ms != directory.modified_unix_ms {
            return false;
        }
    }

    for snapshot in &index.files {
        let Ok(metadata) = fs::metadata(&snapshot.path) else {
            return false;
        };
        let Some(modified_unix_ms) = modified_unix_ms(&metadata) else {
            return false;
        };

        if modified_unix_ms != snapshot.modified_unix_ms || metadata.len() != snapshot.size_bytes {
            return false;
        }
    }

    true
}

fn session_file_index_from_inventory(
    sessions_dir: &Path,
    inventory: SessionTreeInventory,
) -> SessionFileIndex {
    SessionFileIndex {
        version: SESSION_FILE_INDEX_VERSION,
        sessions_dir: sessions_dir.display().to_string(),
        directories: inventory.directories,
        files: inventory.files,
    }
}

fn session_file_snapshots_from_index(index: &SessionFileIndex) -> Vec<SessionFileSnapshot> {
    index.files.clone()
}

fn cache_entry_matches(entry: &CachedSessionSummary, snapshot: &SessionFileSnapshot) -> bool {
    entry.modified_unix_ms == snapshot.modified_unix_ms && entry.size_bytes == snapshot.size_bytes
}

fn cached_summary_for_snapshot(
    entries_by_path: &HashMap<String, CachedSessionSummary>,
    snapshot: &SessionFileSnapshot,
) -> Option<StoredSessionSummary> {
    let path_key = snapshot_path_key(snapshot);
    entries_by_path
        .get(&path_key)
        .filter(|entry| cache_entry_matches(entry, snapshot))
        .map(|entry| entry.summary.clone())
}

fn retained_cache_entries(
    entries: Vec<CachedSessionSummary>,
    discovered_paths: &HashSet<String>,
) -> HashMap<String, CachedSessionSummary> {
    entries
        .into_iter()
        .filter(|entry| discovered_paths.contains(&entry.path))
        .map(|entry| (entry.path.clone(), entry))
        .collect::<HashMap<_, _>>()
}

fn empty_overview(sessions_dir: &Path, generated_at: String) -> CodexOverview {
    CodexOverview {
        provider: "codex".into(),
        generated_at,
        sessions_dir: sessions_dir.display().to_string(),
        latest_session: None,
        sessions: Vec::new(),
        daily_usage: Vec::new(),
        totals: UsageTotals::default(),
        last_turn_totals: UsageTotals::default(),
    }
}

fn should_parse_snapshot_for_overview(
    index: usize,
    snapshot: &SessionFileSnapshot,
    limit: usize,
    daily_window_start_unix_ms: u64,
) -> bool {
    index < limit || snapshot.modified_unix_ms >= daily_window_start_unix_ms
}

fn get_codex_overview_from_sessions_dir(
    sessions_dir: &Path,
    cache_path: Option<&Path>,
    file_index_path: Option<&Path>,
    limit: usize,
) -> Result<CodexOverview, String> {
    let now = Utc::now();
    let generated_at = now.to_rfc3339_opts(SecondsFormat::Secs, true);
    let daily_window_start_unix_ms = (now - Duration::days(DEFAULT_DAILY_WINDOW_DAYS))
        .timestamp_millis()
        .max(0) as u64;

    if !sessions_dir.is_dir() {
        return Ok(empty_overview(sessions_dir, generated_at));
    }

    let snapshots = if let Some(index_path) = file_index_path {
        if let Some(index) = load_session_file_index(index_path, sessions_dir) {
            if session_file_index_is_valid(&index, sessions_dir) {
                session_file_snapshots_from_index(&index)
            } else {
                let inventory = recursive_session_tree_inventory(sessions_dir);
                let next_index = session_file_index_from_inventory(sessions_dir, inventory.clone());
                if let Err(error) = save_session_file_index(index_path, &next_index) {
                    log::warn!("failed to persist session file index: {error}");
                }
                inventory.files
            }
        } else {
            let inventory = recursive_session_tree_inventory(sessions_dir);
            let next_index = session_file_index_from_inventory(sessions_dir, inventory.clone());
            if let Err(error) = save_session_file_index(index_path, &next_index) {
                log::warn!("failed to persist session file index: {error}");
            }
            inventory.files
        }
    } else {
        recursive_jsonl_file_snapshots(sessions_dir)
    };

    let mut snapshots = snapshots;
    snapshots.sort_by(|left, right| right.modified_unix_ms.cmp(&left.modified_unix_ms));

    let discovered_paths = snapshots
        .iter()
        .map(snapshot_path_key)
        .collect::<HashSet<_>>();

    let mut cache = cache_path
        .map(|path| load_session_summary_cache(path, sessions_dir))
        .unwrap_or_else(|| new_session_summary_cache(sessions_dir));

    let entries_by_path = cache.entries.drain(..).collect::<Vec<_>>();
    let mut entries_by_path = retained_cache_entries(entries_by_path, &discovered_paths);

    let mut sessions = Vec::new();
    let mut daily_usage_entries: BTreeMap<(String, String), DailyUsageSummary> = BTreeMap::new();

    for (index, snapshot) in snapshots.iter().enumerate() {
        if !should_parse_snapshot_for_overview(index, snapshot, limit, daily_window_start_unix_ms) {
            continue;
        }

        let path_key = snapshot_path_key(snapshot);

        let stored_summary =
            if let Some(summary) = cached_summary_for_snapshot(&entries_by_path, snapshot) {
                summary
            } else {
                match parse_session_file(&snapshot.path) {
                    Ok(stored_summary) => {
                        entries_by_path.insert(
                            path_key.clone(),
                            CachedSessionSummary {
                                path: path_key,
                                modified_unix_ms: snapshot.modified_unix_ms,
                                size_bytes: snapshot.size_bytes,
                                summary: stored_summary.clone(),
                            },
                        );
                        stored_summary
                    }
                    Err(error) => {
                        entries_by_path.remove(&path_key);
                        log::warn!(
                            "failed to parse session file for overview cache refresh ({}): {}",
                            snapshot.path.display(),
                            error
                        );
                        continue;
                    }
                }
            };

        for record in &stored_summary.daily_usage {
            add_daily_usage_record(&mut daily_usage_entries, record);
        }

        if index < limit {
            sessions.push(enrich_session_summary(stored_summary, now));
        }
    }

    sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));

    let mut totals = UsageTotals::default();
    let mut last_turn_totals = UsageTotals::default();

    for session in &sessions {
        add_usage(&mut totals, &session.total_usage);
        add_usage(&mut last_turn_totals, &session.last_usage);
    }

    if let Some(path) = cache_path {
        cache.entries = entries_by_path.into_values().collect();
        cache
            .entries
            .sort_by(|left, right| left.path.cmp(&right.path));

        if let Err(error) = save_session_summary_cache(path, &cache) {
            log::warn!("failed to persist session summary cache: {error}");
        }
    }

    Ok(CodexOverview {
        provider: "codex".into(),
        generated_at,
        sessions_dir: sessions_dir.display().to_string(),
        latest_session: sessions.first().cloned(),
        sessions,
        daily_usage: daily_usage_entries.into_values().collect(),
        totals,
        last_turn_totals,
    })
}

pub fn get_codex_overview<R: Runtime>(
    app: &AppHandle<R>,
    limit: usize,
) -> Result<CodexOverview, String> {
    let sessions_dir = codex_sessions_dir(app).or_else(|_| default_codex_sessions_dir())?;
    let file_index_path = match session_file_index_path(app) {
        Ok(path) => Some(path),
        Err(error) => {
            log::warn!("failed to resolve session file index path: {error}");
            None
        }
    };
    let cache_path = match session_summary_cache_path(app) {
        Ok(path) => Some(path),
        Err(error) => {
            log::warn!("failed to resolve session summary cache path: {error}");
            None
        }
    };

    get_codex_overview_from_sessions_dir(
        &sessions_dir,
        cache_path.as_deref(),
        file_index_path.as_deref(),
        limit,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        cached_summary_for_snapshot, enrich_session_summary, format_tray_status,
        get_codex_overview_from_sessions_dir, load_session_file_index, load_session_summary_cache,
        modified_unix_ms, new_session_file_index, new_session_summary_cache, parse_session_file,
        recursive_session_tree_inventory, retained_cache_entries, save_session_file_index,
        save_session_summary_cache, session_file_index_from_inventory, session_file_index_is_valid,
        session_file_snapshots_from_index, should_parse_snapshot_for_overview,
        CachedSessionSummary, CodexOverview, CodexSessionSummary, RateLimitSnapshot,
        SessionFileSnapshot, StoredSessionSummary, UsageTotals, SESSION_FILE_INDEX_VERSION,
        SESSION_SUMMARY_CACHE_VERSION,
    };
    use crate::settings;
    use chrono::{Duration, SecondsFormat, Utc};
    use std::{
        collections::{HashMap, HashSet},
        env, fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn stored_session_with_rates(
        primary_used_percent: f64,
        secondary_used_percent: f64,
    ) -> StoredSessionSummary {
        StoredSessionSummary {
            id: "session-1".into(),
            file_path: "/tmp/session-1.jsonl".into(),
            file_name: "session-1.jsonl".into(),
            model: Some("gpt-5.4".into()),
            effort: Some("medium".into()),
            cwd: Some("/tmp".into()),
            updated_at: "2026-03-23T00:00:00.000Z".into(),
            total_usage: Some(UsageTotals::default()),
            last_usage: Some(UsageTotals::default()),
            primary_rate_limit: Some(RateLimitSnapshot {
                used_percent: primary_used_percent,
                window_minutes: Some(300),
                resets_at: None,
            }),
            secondary_rate_limit: Some(RateLimitSnapshot {
                used_percent: secondary_used_percent,
                window_minutes: Some(10_080),
                resets_at: None,
            }),
            daily_usage: Vec::new(),
        }
    }

    fn session_with_rates(
        primary_used_percent: f64,
        secondary_used_percent: f64,
    ) -> CodexSessionSummary {
        enrich_session_summary(
            stored_session_with_rates(primary_used_percent, secondary_used_percent),
            Utc::now(),
        )
    }

    fn overview_with_session(session: CodexSessionSummary) -> CodexOverview {
        CodexOverview {
            provider: "codex".into(),
            generated_at: "2026-03-23T00:00:00Z".into(),
            sessions_dir: "/tmp".into(),
            latest_session: Some(session.clone()),
            sessions: vec![session],
            daily_usage: Vec::new(),
            totals: UsageTotals::default(),
            last_turn_totals: UsageTotals::default(),
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

    fn create_session_tree(base: &PathBuf) -> (PathBuf, PathBuf, PathBuf) {
        let sessions_dir = base.join("sessions");
        let nested_dir = sessions_dir.join("2026").join("03");
        let session_file = nested_dir.join("session-1.jsonl");
        fs::create_dir_all(&nested_dir).expect("nested dir should be created");
        fs::write(&session_file, "{\"type\":\"turn_context\",\"payload\":{\"turn_id\":\"session-1\",\"cwd\":\"/tmp\",\"model\":\"gpt-5.4\",\"effort\":\"medium\"}}\n")
            .expect("session file should be written");
        fs::write(
            nested_dir.join("session-2.jsonl"),
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"total_tokens\":42},\"last_token_usage\":{\"total_tokens\":5}},\"rate_limits\":{\"primary\":{\"used_percent\":12.0},\"secondary\":{\"used_percent\":34.0}}},\"timestamp\":\"2026-03-23T00:00:00.000Z\"}\n",
        )
        .expect("session file should be written");
        (sessions_dir, nested_dir, session_file)
    }

    fn cache_entry(path: &str, modified_unix_ms: u64, size_bytes: u64) -> CachedSessionSummary {
        CachedSessionSummary {
            path: path.to_string(),
            modified_unix_ms,
            size_bytes,
            summary: stored_session_with_rates(10.0, 20.0),
        }
    }

    fn snapshot(path: &str, modified_unix_ms: u64, size_bytes: u64) -> SessionFileSnapshot {
        SessionFileSnapshot {
            path: PathBuf::from(path),
            modified_unix_ms,
            size_bytes,
        }
    }

    fn file_index_path(base: &PathBuf) -> PathBuf {
        base.join("index.json")
    }

    #[test]
    fn format_tray_status_matches_metric_modes() {
        let overview = overview_with_session(session_with_rates(10.4, 20.2));

        assert_eq!(
            format_tray_status(&overview, settings::TrayMetricMode::FiveHour),
            Some("5H 90".into()),
        );
        assert_eq!(
            format_tray_status(&overview, settings::TrayMetricMode::Weekly),
            Some("W 80".into()),
        );
        assert_eq!(
            format_tray_status(&overview, settings::TrayMetricMode::Both),
            Some("5H 90 W 80".into()),
        );
    }

    #[test]
    fn format_tray_status_returns_none_without_latest_session() {
        let overview = CodexOverview {
            provider: "codex".into(),
            generated_at: "2026-03-23T00:00:00Z".into(),
            sessions_dir: "/tmp".into(),
            latest_session: None,
            sessions: Vec::new(),
            daily_usage: Vec::new(),
            totals: UsageTotals::default(),
            last_turn_totals: UsageTotals::default(),
        };

        assert_eq!(
            format_tray_status(&overview, settings::TrayMetricMode::Both),
            None,
        );
    }

    #[test]
    fn cache_hit_reuses_matching_summary() {
        let path = "/tmp/session-1.jsonl";
        let entries = HashMap::from([(path.to_string(), cache_entry(path, 100, 200))]);

        let summary = cached_summary_for_snapshot(&entries, &snapshot(path, 100, 200));

        assert_eq!(
            summary.and_then(|value| value.model),
            Some("gpt-5.4".to_string())
        );
    }

    #[test]
    fn changed_file_invalidation_rejects_stale_summary() {
        let path = "/tmp/session-1.jsonl";
        let entries = HashMap::from([(path.to_string(), cache_entry(path, 100, 200))]);

        let summary = cached_summary_for_snapshot(&entries, &snapshot(path, 101, 200));

        assert!(summary.is_none());
    }

    #[test]
    fn removed_file_eviction_drops_orphaned_entries() {
        let path = "/tmp/session-1.jsonl";
        let retained = retained_cache_entries(vec![cache_entry(path, 100, 200)], &HashSet::new());

        assert!(retained.is_empty());
    }

    #[test]
    fn corrupted_cache_falls_back_to_empty_store() {
        let temp_dir = unique_temp_dir("corrupted-session-cache");
        let sessions_dir = temp_dir.join("sessions");
        let cache_path = temp_dir.join("cache.json");
        fs::create_dir_all(&sessions_dir).expect("sessions dir should exist");
        fs::write(&cache_path, "{ not-valid-json ").expect("cache should be written");

        let cache = load_session_summary_cache(&cache_path, &sessions_dir);

        assert_eq!(cache.version, SESSION_SUMMARY_CACHE_VERSION);
        assert_eq!(cache.sessions_dir, sessions_dir.display().to_string());
        assert!(cache.entries.is_empty());

        fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
    }

    #[test]
    fn session_summary_cache_round_trips() {
        let temp_dir = unique_temp_dir("session-cache-round-trip");
        let sessions_dir = temp_dir.join("sessions");
        let cache_path = temp_dir.join("cache.json");
        fs::create_dir_all(&sessions_dir).expect("sessions dir should exist");

        let mut cache = new_session_summary_cache(&sessions_dir);
        cache
            .entries
            .push(cache_entry("/tmp/session-1.jsonl", 100, 200));
        save_session_summary_cache(&cache_path, &cache).expect("cache should save");
        let payload = fs::read_to_string(&cache_path).expect("cache should read");

        let loaded = load_session_summary_cache(&cache_path, &sessions_dir);

        assert!(!payload.contains("\"status\""));
        assert_eq!(loaded.version, SESSION_SUMMARY_CACHE_VERSION);
        assert_eq!(loaded.entries.len(), 1);
        assert_eq!(loaded.entries[0].path, "/tmp/session-1.jsonl");

        fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
    }

    #[test]
    fn runtime_enrichment_recomputes_freshness_from_updated_at() {
        let now = Utc::now();
        let recent = StoredSessionSummary {
            updated_at: now.to_rfc3339_opts(SecondsFormat::Millis, true),
            ..stored_session_with_rates(10.0, 20.0)
        };
        let stale = StoredSessionSummary {
            updated_at: "2026-03-01T00:00:00.000Z".into(),
            ..stored_session_with_rates(10.0, 20.0)
        };

        assert_eq!(enrich_session_summary(recent, now).status, "active");
        assert_eq!(enrich_session_summary(stale, now).status, "idle");
    }

    #[test]
    fn runtime_enrichment_marks_fifteen_minute_boundary_idle() {
        let now = Utc::now();
        let boundary = StoredSessionSummary {
            updated_at: (now - Duration::minutes(15)).to_rfc3339_opts(SecondsFormat::Millis, true),
            ..stored_session_with_rates(10.0, 20.0)
        };

        assert_eq!(enrich_session_summary(boundary, now).status, "idle");
    }

    #[test]
    fn overview_recomputes_cached_session_status_on_cache_hit() {
        let temp_dir = unique_temp_dir("session-cache-status-refresh");
        let sessions_dir = temp_dir.join("sessions");
        let cache_path = temp_dir.join("cache.json");
        fs::create_dir_all(&sessions_dir).expect("sessions dir should exist");

        let session_path = sessions_dir.join("session-1.jsonl");
        fs::write(&session_path, "{\"type\":\"noop\"}\n").expect("session file should exist");
        let metadata = fs::metadata(&session_path).expect("metadata should load");
        let modified_unix_ms = modified_unix_ms(&metadata).expect("modified time should exist");

        let mut cache = new_session_summary_cache(&sessions_dir);
        cache.entries.push(CachedSessionSummary {
            path: session_path.display().to_string(),
            modified_unix_ms,
            size_bytes: metadata.len(),
            summary: StoredSessionSummary {
                file_path: session_path.display().to_string(),
                file_name: "session-1.jsonl".into(),
                updated_at: (Utc::now() - Duration::minutes(20))
                    .to_rfc3339_opts(SecondsFormat::Millis, true),
                ..stored_session_with_rates(10.0, 20.0)
            },
        });
        save_session_summary_cache(&cache_path, &cache).expect("cache should save");

        let overview =
            get_codex_overview_from_sessions_dir(&sessions_dir, Some(&cache_path), None, 1)
                .expect("overview should load from cache");

        assert_eq!(overview.sessions.len(), 1);
        assert_eq!(overview.sessions[0].status, "idle");

        fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
    }

    #[test]
    fn overview_keeps_recent_cached_session_active_on_cache_hit() {
        let temp_dir = unique_temp_dir("session-cache-status-active");
        let sessions_dir = temp_dir.join("sessions");
        let cache_path = temp_dir.join("cache.json");
        fs::create_dir_all(&sessions_dir).expect("sessions dir should exist");

        let session_path = sessions_dir.join("session-1.jsonl");
        fs::write(&session_path, "{\"type\":\"noop\"}\n").expect("session file should exist");
        let metadata = fs::metadata(&session_path).expect("metadata should load");
        let modified_unix_ms = modified_unix_ms(&metadata).expect("modified time should exist");

        let mut cache = new_session_summary_cache(&sessions_dir);
        cache.entries.push(CachedSessionSummary {
            path: session_path.display().to_string(),
            modified_unix_ms,
            size_bytes: metadata.len(),
            summary: StoredSessionSummary {
                file_path: session_path.display().to_string(),
                file_name: "session-1.jsonl".into(),
                updated_at: (Utc::now() - Duration::minutes(5))
                    .to_rfc3339_opts(SecondsFormat::Millis, true),
                ..stored_session_with_rates(10.0, 20.0)
            },
        });
        save_session_summary_cache(&cache_path, &cache).expect("cache should save");

        let overview =
            get_codex_overview_from_sessions_dir(&sessions_dir, Some(&cache_path), None, 1)
                .expect("overview should load from cache");

        assert_eq!(overview.sessions.len(), 1);
        assert_eq!(overview.sessions[0].status, "active");

        fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
    }

    #[test]
    fn parser_prefers_general_codex_plan_limits_over_model_specific_limits() {
        let temp_dir = unique_temp_dir("preferred-plan-limit");
        let session_path = temp_dir.join("session.jsonl");
        fs::write(
            &session_path,
            concat!(
                "{\"timestamp\":\"2026-05-02T10:00:00.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"total_tokens\":100},\"last_token_usage\":{\"total_tokens\":10}},\"rate_limits\":{\"limit_id\":\"codex\",\"primary\":{\"used_percent\":39.0},\"secondary\":{\"used_percent\":20.0}}}}\n",
                "{\"timestamp\":\"2026-05-02T10:00:01.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"total_tokens\":150},\"last_token_usage\":{\"total_tokens\":50}},\"rate_limits\":{\"limit_id\":\"codex_bengalfox\",\"limit_name\":\"GPT-5.3-Codex-Spark\",\"primary\":{\"used_percent\":0.0},\"secondary\":{\"used_percent\":0.0}}}}\n",
            ),
        )
        .expect("session file should be written");

        let summary = parse_session_file(&session_path).expect("session should parse");

        assert_eq!(summary.total_usage.expect("total usage").total_tokens, 150);
        assert_eq!(
            summary
                .primary_rate_limit
                .expect("primary limit")
                .used_percent,
            39.0,
        );
        assert_eq!(
            summary
                .secondary_rate_limit
                .expect("secondary limit")
                .used_percent,
            20.0,
        );

        fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
    }

    #[test]
    fn parser_builds_daily_usage_from_total_usage_deltas() {
        let temp_dir = unique_temp_dir("daily-usage-deltas");
        let session_path = temp_dir.join("session.jsonl");
        fs::write(
            &session_path,
            concat!(
                "{\"type\":\"turn_context\",\"payload\":{\"turn_id\":\"session-1\",\"cwd\":\"/tmp/project\",\"model\":\"gpt-5.4\"}}\n",
                "{\"timestamp\":\"2026-05-01T12:00:00.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":100,\"output_tokens\":10,\"total_tokens\":110}}}}\n",
                "{\"timestamp\":\"2026-05-01T12:01:00.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":150,\"output_tokens\":20,\"total_tokens\":170}}}}\n",
                "{\"timestamp\":\"2026-05-02T12:00:00.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":120,\"output_tokens\":30,\"total_tokens\":150}}}}\n",
            ),
        )
        .expect("session file should be written");

        let summary = parse_session_file(&session_path).expect("session should parse");

        assert_eq!(summary.daily_usage.len(), 2);
        assert_eq!(summary.daily_usage[0].date, "2026-05-01");
        assert_eq!(summary.daily_usage[0].cwd, Some("/tmp/project".into()));
        assert_eq!(summary.daily_usage[0].session_count, 1);
        assert_eq!(summary.daily_usage[0].usage.input_tokens, 150);
        assert_eq!(summary.daily_usage[0].usage.output_tokens, 20);
        assert_eq!(summary.daily_usage[0].usage.total_tokens, 170);
        assert_eq!(summary.daily_usage[1].date, "2026-05-02");
        assert_eq!(summary.daily_usage[1].usage.input_tokens, 0);
        assert_eq!(summary.daily_usage[1].usage.output_tokens, 10);
        assert_eq!(summary.daily_usage[1].usage.total_tokens, 0);

        fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
    }

    #[test]
    fn overview_parser_skips_old_snapshots_outside_recent_session_limit() {
        let old_snapshot = snapshot("/tmp/old-session.jsonl", 1_000, 100);
        let recent_snapshot = snapshot("/tmp/recent-session.jsonl", 50_000, 100);
        let daily_window_start_unix_ms = 10_000;

        assert!(should_parse_snapshot_for_overview(
            0,
            &old_snapshot,
            1,
            daily_window_start_unix_ms,
        ));
        assert!(!should_parse_snapshot_for_overview(
            1,
            &old_snapshot,
            1,
            daily_window_start_unix_ms,
        ));
        assert!(should_parse_snapshot_for_overview(
            1,
            &recent_snapshot,
            1,
            daily_window_start_unix_ms,
        ));
    }

    #[test]
    fn session_file_index_round_trips_and_reuses_valid_tree() {
        let temp_dir = unique_temp_dir("session-file-index-round-trip");
        let (sessions_dir, _nested_dir, _session_file) = create_session_tree(&temp_dir);
        let index_path = file_index_path(&temp_dir);

        let inventory = recursive_session_tree_inventory(&sessions_dir);
        let index = session_file_index_from_inventory(&sessions_dir, inventory.clone());
        save_session_file_index(&index_path, &index).expect("index should save");

        let loaded =
            load_session_file_index(&index_path, &sessions_dir).expect("index should load");

        assert!(session_file_index_is_valid(&loaded, &sessions_dir));
        assert_eq!(loaded.version, SESSION_FILE_INDEX_VERSION);
        assert_eq!(loaded.sessions_dir, sessions_dir.display().to_string());
        assert_eq!(loaded.files.len(), inventory.files.len());
        assert_eq!(
            session_file_snapshots_from_index(&loaded)
                .into_iter()
                .map(|snapshot| snapshot.path.display().to_string())
                .collect::<Vec<_>>(),
            inventory
                .files
                .into_iter()
                .map(|snapshot| snapshot.path.display().to_string())
                .collect::<Vec<_>>(),
        );

        fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
    }

    #[test]
    fn session_file_index_rejects_changed_file_metadata() {
        let temp_dir = unique_temp_dir("session-file-index-change");
        let (sessions_dir, _nested_dir, session_file) = create_session_tree(&temp_dir);
        let index_path = file_index_path(&temp_dir);

        let inventory = recursive_session_tree_inventory(&sessions_dir);
        let index = session_file_index_from_inventory(&sessions_dir, inventory);
        save_session_file_index(&index_path, &index).expect("index should save");

        fs::write(&session_file, "changed").expect("session file should change");

        let loaded =
            load_session_file_index(&index_path, &sessions_dir).expect("index should load");
        assert!(!session_file_index_is_valid(&loaded, &sessions_dir));

        fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
    }

    #[test]
    fn session_file_index_rejects_root_mismatch() {
        let temp_dir = unique_temp_dir("session-file-index-root");
        let sessions_dir = temp_dir.join("sessions");
        let other_sessions_dir = temp_dir.join("other-sessions");
        let index_path = file_index_path(&temp_dir);
        fs::create_dir_all(&sessions_dir).expect("sessions dir should exist");
        fs::create_dir_all(&other_sessions_dir).expect("other sessions dir should exist");

        let index = new_session_file_index(&sessions_dir);
        save_session_file_index(&index_path, &index).expect("index should save");

        assert!(load_session_file_index(&index_path, &other_sessions_dir).is_none());

        fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
    }

    #[test]
    fn session_file_index_falls_back_on_corruption() {
        let temp_dir = unique_temp_dir("session-file-index-corrupted");
        let sessions_dir = temp_dir.join("sessions");
        let index_path = file_index_path(&temp_dir);
        fs::create_dir_all(&sessions_dir).expect("sessions dir should exist");
        fs::write(&index_path, "{ not-valid-json ").expect("corrupt index should be written");

        assert!(load_session_file_index(&index_path, &sessions_dir).is_none());

        fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
    }
}
