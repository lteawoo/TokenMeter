export type ProviderId = "codex";

export type UsageTotals = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

export type RateLimitSnapshot = {
  usedPercent: number;
  windowMinutes: number | null;
  resetsAt: string | null;
};

export type CodexSessionSummary = {
  id: string;
  filePath: string;
  fileName: string;
  model: string | null;
  effort: string | null;
  cwd: string | null;
  updatedAt: string;
  totalUsage: UsageTotals | null;
  lastUsage: UsageTotals | null;
  primaryRateLimit: RateLimitSnapshot | null;
  secondaryRateLimit: RateLimitSnapshot | null;
  status: "active" | "idle";
};

export type DailyUsageSummary = {
  date: string;
  cwd: string | null;
  filePath: string | null;
  sessionCount: number;
  usage: UsageTotals;
};

export type CodexOverview = {
  provider: ProviderId;
  generatedAt: string;
  sessionsDir: string;
  latestSession: CodexSessionSummary | null;
  sessions: CodexSessionSummary[];
  dailyUsage: DailyUsageSummary[];
  totals: UsageTotals;
  lastTurnTotals: UsageTotals;
};
