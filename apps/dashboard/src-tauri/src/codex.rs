use std::{
    collections::{HashMap, HashSet},
    env,
    fs::{self, DirEntry, File},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime};

use crate::settings;

const DEFAULT_LIMIT: usize = 12;
const MIN_LIMIT: usize = 1;
const MAX_LIMIT: usize = 25;
const SESSION_SUMMARY_CACHE_FILE_NAME: &str = "codex-session-summary-cache.json";
const SESSION_SUMMARY_CACHE_VERSION: u32 = 2;

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexOverview {
    provider: String,
    generated_at: String,
    sessions_dir: String,
    latest_session: Option<CodexSessionSummary>,
    sessions: Vec<CodexSessionSummary>,
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

#[derive(Debug, Clone)]
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
        }
    }
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

fn new_session_summary_cache(sessions_dir: &Path) -> SessionSummaryCache {
    SessionSummaryCache {
        version: SESSION_SUMMARY_CACHE_VERSION,
        sessions_dir: sessions_dir.display().to_string(),
        entries: Vec::new(),
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

fn save_session_summary_cache(path: &Path, cache: &SessionSummaryCache) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let payload = serde_json::to_string_pretty(cache).map_err(|error| error.to_string())?;
    fs::write(path, payload).map_err(|error| error.to_string())
}

fn session_status_from_updated_at(updated_at: &str) -> String {
    let updated = DateTime::parse_from_rfc3339(updated_at)
        .map(|value| value.with_timezone(&Utc))
        .unwrap_or_else(|_| DateTime::<Utc>::from(std::time::UNIX_EPOCH));
    let is_active = Utc::now().signed_duration_since(updated).num_minutes() < 15;

    if is_active {
        "active".into()
    } else {
        "idle".into()
    }
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

fn recursive_jsonl_file_snapshots(dir: &Path) -> Vec<SessionFileSnapshot> {
    let mut files = Vec::new();
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return files,
    };

    for entry in entries {
        let entry: DirEntry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();

        if path.is_dir() {
            files.extend(recursive_jsonl_file_snapshots(&path));
        } else if path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value == "jsonl")
        {
            let Ok(metadata) = fs::metadata(&path) else {
                continue;
            };
            let Some(modified_unix_ms) = modified_unix_ms(&metadata) else {
                continue;
            };

            files.push(SessionFileSnapshot {
                path,
                modified_unix_ms,
                size_bytes: metadata.len(),
            });
        }
    }

    files
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

fn add_usage(left: &mut UsageTotals, right: &Option<UsageTotals>) {
    if let Some(value) = right {
        left.input_tokens += value.input_tokens;
        left.cached_input_tokens += value.cached_input_tokens;
        left.output_tokens += value.output_tokens;
        left.reasoning_output_tokens += value.reasoning_output_tokens;
        left.total_tokens += value.total_tokens;
    }
}

fn enrich_session_summary(summary: StoredSessionSummary) -> CodexSessionSummary {
    let status = session_status_from_updated_at(&summary.updated_at);

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
            summary.total_usage =
                usage_from_value(&info["total_token_usage"]).or(summary.total_usage);
            summary.last_usage = usage_from_value(&info["last_token_usage"]).or(summary.last_usage);
            summary.primary_rate_limit =
                rate_limit_from_value(&event["payload"]["rate_limits"]["primary"])
                    .or(summary.primary_rate_limit);
            summary.secondary_rate_limit =
                rate_limit_from_value(&event["payload"]["rate_limits"]["secondary"])
                    .or(summary.secondary_rate_limit);
            summary.updated_at = event["timestamp"]
                .as_str()
                .map(str::to_string)
                .unwrap_or(summary.updated_at);
        }
    }

    if summary.updated_at.starts_with("1970-01-01") {
        let metadata = fs::metadata(path).map_err(|err| err.to_string())?;
        let modified = metadata.modified().map_err(|err| err.to_string())?;
        summary.updated_at =
            DateTime::<Utc>::from(modified).to_rfc3339_opts(SecondsFormat::Millis, true);
    }

    Ok(summary)
}

fn snapshot_path_key(snapshot: &SessionFileSnapshot) -> String {
    snapshot.path.display().to_string()
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
        totals: UsageTotals::default(),
        last_turn_totals: UsageTotals::default(),
    }
}

fn get_codex_overview_from_sessions_dir(
    sessions_dir: &Path,
    cache_path: Option<&Path>,
    limit: usize,
) -> Result<CodexOverview, String> {
    let generated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

    if !sessions_dir.is_dir() {
        return Ok(empty_overview(sessions_dir, generated_at));
    }

    let mut snapshots = recursive_jsonl_file_snapshots(sessions_dir);
    snapshots.sort_by(|left, right| right.modified_unix_ms.cmp(&left.modified_unix_ms));

    let discovered_paths = snapshots
        .iter()
        .map(snapshot_path_key)
        .collect::<HashSet<_>>();

    let mut cache = cache_path
        .map(|path| load_session_summary_cache(path, sessions_dir))
        .unwrap_or_else(|| new_session_summary_cache(sessions_dir));

    let entries_by_path = cache
        .entries
        .drain(..)
        .collect::<Vec<_>>();
    let mut entries_by_path = retained_cache_entries(entries_by_path, &discovered_paths);

    let mut sessions = Vec::new();

    for snapshot in snapshots.iter().take(limit) {
        let path_key = snapshot_path_key(snapshot);

        if let Some(summary) = cached_summary_for_snapshot(&entries_by_path, snapshot) {
            sessions.push(enrich_session_summary(summary));
            continue;
        }

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
                sessions.push(enrich_session_summary(stored_summary));
            }
            Err(error) => {
                entries_by_path.remove(&path_key);
                log::warn!(
                    "failed to parse session file for overview cache refresh ({}): {}",
                    snapshot.path.display(),
                    error
                );
            }
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
        cache.entries.sort_by(|left, right| left.path.cmp(&right.path));

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
        totals,
        last_turn_totals,
    })
}

pub fn get_codex_overview<R: Runtime>(
    app: &AppHandle<R>,
    limit: usize,
) -> Result<CodexOverview, String> {
    let sessions_dir = codex_sessions_dir(app).or_else(|_| default_codex_sessions_dir())?;
    let cache_path = match session_summary_cache_path(app) {
        Ok(path) => Some(path),
        Err(error) => {
            log::warn!("failed to resolve session summary cache path: {error}");
            None
        }
    };

    get_codex_overview_from_sessions_dir(&sessions_dir, cache_path.as_deref(), limit)
}

#[cfg(test)]
mod tests {
    use super::{
        cached_summary_for_snapshot, enrich_session_summary, format_tray_status,
        load_session_summary_cache, new_session_summary_cache, retained_cache_entries,
        save_session_summary_cache, CachedSessionSummary, CodexOverview, CodexSessionSummary,
        RateLimitSnapshot, SessionFileSnapshot, StoredSessionSummary, UsageTotals,
        SESSION_SUMMARY_CACHE_VERSION,
    };
    use crate::settings;
    use std::{
        collections::{HashMap, HashSet},
        env, fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };
    use chrono::{SecondsFormat, Utc};

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
        }
    }

    fn session_with_rates(primary_used_percent: f64, secondary_used_percent: f64) -> CodexSessionSummary {
        enrich_session_summary(stored_session_with_rates(
            primary_used_percent,
            secondary_used_percent,
        ))
    }

    fn overview_with_session(session: CodexSessionSummary) -> CodexOverview {
        CodexOverview {
            provider: "codex".into(),
            generated_at: "2026-03-23T00:00:00Z".into(),
            sessions_dir: "/tmp".into(),
            latest_session: Some(session.clone()),
            sessions: vec![session],
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

        assert_eq!(summary.and_then(|value| value.model), Some("gpt-5.4".to_string()));
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
        cache.entries.push(cache_entry("/tmp/session-1.jsonl", 100, 200));
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
        let recent = StoredSessionSummary {
            updated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            ..stored_session_with_rates(10.0, 20.0)
        };
        let stale = StoredSessionSummary {
            updated_at: "2026-03-01T00:00:00.000Z".into(),
            ..stored_session_with_rates(10.0, 20.0)
        };

        assert_eq!(enrich_session_summary(recent).status, "active");
        assert_eq!(enrich_session_summary(stale).status, "idle");
    }
}
