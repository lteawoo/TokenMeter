import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

import type {
  CodexSessionSummary,
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

export const DEFAULT_CODEX_SESSIONS_DIR = path.join(
  os.homedir(),
  ".codex",
  "sessions",
);

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
    inputTokens: value.input_tokens ?? 0,
    cachedInputTokens: value.cached_input_tokens ?? 0,
    outputTokens: value.output_tokens ?? 0,
    reasoningOutputTokens: value.reasoning_output_tokens ?? 0,
    totalTokens: value.total_tokens ?? 0,
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

async function parseCodexSessionFile(
  filePath: string,
): Promise<CodexSessionSummary> {
  const summary = createEmptySessionSummary(filePath);
  let selectedRateLimitId: string | null = null;
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
      summary.totalUsage = toUsageTotals(info?.total_token_usage) ?? summary.totalUsage;
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

  const fileStat = await fs.stat(filePath);
  if (summary.updatedAt === new Date(0).toISOString()) {
    summary.updatedAt = fileStat.mtime.toISOString();
  }

  summary.status =
    Date.now() - new Date(summary.updatedAt).getTime() < 15 * 60 * 1000
      ? "active"
      : "idle";

  return summary;
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
    sortedFiles.map(({ filePath }) => parseCodexSessionFile(filePath)),
  );

  return sessions.sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

export function summariseCodexSessions(sessions: CodexSessionSummary[]) {
  return {
    latestSession: sessions[0] ?? null,
    sessions,
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
