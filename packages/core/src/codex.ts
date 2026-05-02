import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

import type {
  CodexSessionSummary,
  DailyUsageSummary,
  RateLimitSnapshot,
  UsageTotals,
} from "./models.js";

type TokenUsagePayload = {
  total_token_usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
    total_tokens?: number;
  };
  last_token_usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
    total_tokens?: number;
  };
};

type ParsedSessionEvent = {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    info?: TokenUsagePayload;
    rate_limits?: {
      limit_id?: string;
      primary?: {
        used_percent?: number;
        window_minutes?: number;
        resets_at?: number;
      };
      secondary?: {
        used_percent?: number;
        window_minutes?: number;
        resets_at?: number;
      };
    };
    cwd?: string;
    model?: string;
    effort?: string;
    turn_id?: string;
  };
};

const ZERO_USAGE: UsageTotals = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
};
const PREFERRED_PLAN_LIMIT_ID = "codex";
const DEFAULT_DAILY_WINDOW_DAYS = 30;
const SESSION_PARSE_BATCH_SIZE = 8;

export const DEFAULT_CODEX_SESSIONS_DIR = path.join(
  os.homedir(),
  ".codex",
  "sessions",
);

function toUsageNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function toUsageTotals(value?: {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}): UsageTotals | null {
  if (!value) {
    return null;
  }

  return {
    inputTokens: toUsageNumber(value.input_tokens),
    cachedInputTokens: toUsageNumber(value.cached_input_tokens),
    outputTokens: toUsageNumber(value.output_tokens),
    reasoningOutputTokens: toUsageNumber(value.reasoning_output_tokens),
    totalTokens: toUsageNumber(value.total_tokens),
  };
}

function toRateLimitSnapshot(value?: {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
}): RateLimitSnapshot | null {
  if (!value) {
    return null;
  }

  return {
    usedPercent: value.used_percent ?? 0,
    windowMinutes: value.window_minutes ?? null,
    resetsAt: value.resets_at
      ? new Date(value.resets_at * 1000).toISOString()
      : null,
  };
}

function shouldReplaceRateLimits(
  currentLimitId: string | null,
  nextLimitId: string | null,
) {
  if (nextLimitId === PREFERRED_PLAN_LIMIT_ID) {
    return true;
  }

  if (currentLimitId === PREFERRED_PLAN_LIMIT_ID) {
    return false;
  }

  return true;
}

function createEmptySessionSummary(filePath: string): CodexSessionSummary {
  const fileName = path.basename(filePath);

  return {
    id: fileName.replace(/\.jsonl$/i, ""),
    filePath,
    fileName,
    model: null,
    effort: null,
    cwd: null,
    updatedAt: new Date(0).toISOString(),
    totalUsage: null,
    lastUsage: null,
    primaryRateLimit: null,
    secondaryRateLimit: null,
    status: "idle",
  };
}

function cloneUsageTotals(value: UsageTotals): UsageTotals {
  return { ...value };
}

function getUsageDelta(
  current: UsageTotals,
  previous: UsageTotals | null,
): UsageTotals {
  if (!previous) {
    return cloneUsageTotals(current);
  }

  return {
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    cachedInputTokens: Math.max(
      0,
      current.cachedInputTokens - previous.cachedInputTokens,
    ),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    reasoningOutputTokens: Math.max(
      0,
      current.reasoningOutputTokens - previous.reasoningOutputTokens,
    ),
    totalTokens: Math.max(0, current.totalTokens - previous.totalTokens),
  };
}

function formatLocalDateKey(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function localDateKeyFromTimestamp(
  timestamp: string | undefined,
  fallback: Date,
) {
  if (timestamp) {
    const parsed = new Date(timestamp);
    if (!Number.isNaN(parsed.getTime())) {
      return formatLocalDateKey(parsed);
    }
  }

  return formatLocalDateKey(fallback);
}

function dailyUsageKey(date: string, cwd: string | null, filePath: string) {
  return `${date}\u0000${cwd ?? filePath}`;
}

function addDailyUsage(
  dailyUsageByKey: Map<string, DailyUsageSummary>,
  options: {
    date: string;
    cwd: string | null;
    filePath: string;
    usage: UsageTotals;
  },
) {
  const key = dailyUsageKey(options.date, options.cwd, options.filePath);
  const existing = dailyUsageByKey.get(key);

  if (existing) {
    existing.usage = addUsage(existing.usage, options.usage);
    return;
  }

  dailyUsageByKey.set(key, {
    date: options.date,
    cwd: options.cwd,
    filePath: options.cwd ? null : options.filePath,
    sessionCount: 1,
    usage: cloneUsageTotals(options.usage),
  });
}

async function collectJsonlFiles(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry: import("node:fs").Dirent) => {
      const entryPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return collectJsonlFiles(entryPath);
      }

      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        return [entryPath];
      }

      return [];
    }),
  );

  return nestedFiles.flat();
}

type ParsedCodexSessionFile = {
  summary: CodexSessionSummary;
  dailyUsage: DailyUsageSummary[];
};

async function parseCodexSessionFile(
  filePath: string,
): Promise<ParsedCodexSessionFile> {
  const summary = createEmptySessionSummary(filePath);
  const fileStat = await fs.stat(filePath);
  const fallbackDate = fileStat.mtime;
  const dailyUsageByKey = new Map<string, DailyUsageSummary>();
  let selectedRateLimitId: string | null = null;
  let previousTotalUsage: UsageTotals | null = null;
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    let event: ParsedSessionEvent;

    try {
      event = JSON.parse(line) as ParsedSessionEvent;
    } catch {
      continue;
    }

    if (event.type === "turn_context") {
      summary.cwd = event.payload?.cwd ?? summary.cwd;
      summary.model = event.payload?.model ?? summary.model;
      summary.effort = event.payload?.effort ?? summary.effort;
      summary.id = event.payload?.turn_id ?? summary.id;
    }

    if (event.type === "event_msg" && event.payload?.type === "token_count") {
      const info = event.payload.info;
      const totalUsage = toUsageTotals(info?.total_token_usage);
      if (totalUsage) {
        addDailyUsage(dailyUsageByKey, {
          date: localDateKeyFromTimestamp(event.timestamp, fallbackDate),
          cwd: summary.cwd,
          filePath,
          usage: getUsageDelta(totalUsage, previousTotalUsage),
        });
        previousTotalUsage = totalUsage;
        summary.totalUsage = totalUsage;
      }
      summary.lastUsage = toUsageTotals(info?.last_token_usage) ?? summary.lastUsage;
      const nextRateLimitId = event.payload.rate_limits?.limit_id ?? null;
      if (shouldReplaceRateLimits(selectedRateLimitId, nextRateLimitId)) {
        selectedRateLimitId = nextRateLimitId;
        summary.primaryRateLimit =
          toRateLimitSnapshot(event.payload.rate_limits?.primary) ?? summary.primaryRateLimit;
        summary.secondaryRateLimit =
          toRateLimitSnapshot(event.payload.rate_limits?.secondary) ??
          summary.secondaryRateLimit;
      }
      summary.updatedAt = event.timestamp ?? summary.updatedAt;
    }
  }

  if (summary.updatedAt === new Date(0).toISOString()) {
    summary.updatedAt = fileStat.mtime.toISOString();
  }

  summary.status =
    Date.now() - new Date(summary.updatedAt).getTime() < 15 * 60 * 1000
      ? "active"
      : "idle";

  return {
    summary,
    dailyUsage: Array.from(dailyUsageByKey.values()).sort((left, right) => {
      const dateComparison = left.date.localeCompare(right.date);
      if (dateComparison !== 0) {
        return dateComparison;
      }

      return (left.cwd ?? left.filePath ?? "").localeCompare(
        right.cwd ?? right.filePath ?? "",
      );
    }),
  };
}

function addUsage(left: UsageTotals, right: UsageTotals | null): UsageTotals {
  if (!right) {
    return left;
  }

  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningOutputTokens:
      left.reasoningOutputTokens + right.reasoningOutputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function aggregateDailyUsage(records: DailyUsageSummary[]): DailyUsageSummary[] {
  const dailyUsageByKey = new Map<string, DailyUsageSummary>();

  records.forEach((record) => {
    const key = dailyUsageKey(record.date, record.cwd, record.filePath ?? "");
    const existing = dailyUsageByKey.get(key);

    if (existing) {
      existing.sessionCount += record.sessionCount;
      existing.usage = addUsage(existing.usage, record.usage);
      return;
    }

    dailyUsageByKey.set(key, {
      ...record,
      usage: cloneUsageTotals(record.usage),
    });
  });

  return Array.from(dailyUsageByKey.values()).sort((left, right) => {
    const dateComparison = left.date.localeCompare(right.date);
    if (dateComparison !== 0) {
      return dateComparison;
    }

    return (left.cwd ?? left.filePath ?? "").localeCompare(
      right.cwd ?? right.filePath ?? "",
    );
  });
}

async function parseSessionFilesInBatches(filePaths: string[]) {
  const parsedFiles: ParsedCodexSessionFile[] = [];

  for (let index = 0; index < filePaths.length; index += SESSION_PARSE_BATCH_SIZE) {
    const batch = filePaths.slice(index, index + SESSION_PARSE_BATCH_SIZE);
    parsedFiles.push(
      ...(await Promise.all(batch.map((filePath) => parseCodexSessionFile(filePath)))),
    );
  }

  return parsedFiles;
}

export async function listRecentCodexSessions(options?: {
  limit?: number;
  rootDir?: string;
}): Promise<CodexSessionSummary[]> {
  const rootDir = options?.rootDir ?? DEFAULT_CODEX_SESSIONS_DIR;
  const limit = options?.limit ?? 12;

  const stats = await fs.stat(rootDir).catch(() => null);
  if (!stats?.isDirectory()) {
    return [];
  }

  const files = await collectJsonlFiles(rootDir);
  const filesWithStats = await Promise.all(
    files.map(async (filePath) => ({
      filePath,
      stat: await fs.stat(filePath),
    })),
  );

  const sortedFiles = filesWithStats
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)
    .slice(0, limit);

  const sessions = await Promise.all(
    sortedFiles.map(({ filePath }) =>
      parseCodexSessionFile(filePath).then((result) => result.summary),
    ),
  );

  return sessions.sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

export async function getCodexOverviewData(options?: {
  limit?: number;
  rootDir?: string;
  dailyWindowDays?: number;
}): Promise<{
  sessions: CodexSessionSummary[];
  dailyUsage: DailyUsageSummary[];
}> {
  const rootDir = options?.rootDir ?? DEFAULT_CODEX_SESSIONS_DIR;
  const limit = options?.limit ?? 12;
  const dailyWindowDays = options?.dailyWindowDays ?? DEFAULT_DAILY_WINDOW_DAYS;

  const stats = await fs.stat(rootDir).catch(() => null);
  if (!stats?.isDirectory()) {
    return {
      sessions: [],
      dailyUsage: [],
    };
  }

  const files = await collectJsonlFiles(rootDir);
  const filesWithStats = await Promise.all(
    files.map(async (filePath) => ({
      filePath,
      stat: await fs.stat(filePath),
    })),
  );

  const sortedFiles = filesWithStats.sort(
    (left, right) => right.stat.mtimeMs - left.stat.mtimeMs,
  );
  const dailyWindowStartMs =
    Date.now() - Math.max(1, dailyWindowDays) * 24 * 60 * 60 * 1000;
  const selectedFilePaths = Array.from(
    new Set([
      ...sortedFiles.slice(0, limit).map(({ filePath }) => filePath),
      ...sortedFiles
        .filter(({ stat }) => stat.mtimeMs >= dailyWindowStartMs)
        .map(({ filePath }) => filePath),
    ]),
  );
  const parsedFiles = await parseSessionFilesInBatches(selectedFilePaths);
  const sortedSessions = parsedFiles
    .slice(0, limit)
    .map((result) => result.summary)
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() -
        new Date(left.updatedAt).getTime(),
    );

  return {
    sessions: sortedSessions,
    dailyUsage: aggregateDailyUsage(
      parsedFiles.flatMap((result) => result.dailyUsage),
    ),
  };
}

export function summariseCodexSessions(
  sessions: CodexSessionSummary[],
  dailyUsage: DailyUsageSummary[] = [],
) {
  return {
    latestSession: sessions[0] ?? null,
    sessions,
    dailyUsage,
    totals: sessions.reduce(
      (acc, session) => addUsage(acc, session.totalUsage),
      ZERO_USAGE,
    ),
    lastTurnTotals: sessions.reduce(
      (acc, session) => addUsage(acc, session.lastUsage),
      ZERO_USAGE,
    ),
  };
}
