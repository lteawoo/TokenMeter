import type { CodexSessionSummary } from "@tokenmeter/core";

export type ThemeMode = "system" | "dark" | "light";
export type TrayMetricMode = "five-hour" | "weekly" | "both";
export type TrayPresentationMode = "text-only";

export type AppSettings = {
  codexRootPath: string;
  themeMode: ThemeMode;
  trayMetricMode: TrayMetricMode;
  trayPresentationMode: TrayPresentationMode;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  codexRootPath: "~/.codex/sessions",
  themeMode: "dark",
  trayMetricMode: "weekly",
  trayPresentationMode: "text-only",
};

function getRemainingPercent(value: number | null | undefined) {
  if (value == null) {
    return null;
  }

  return Math.max(0, 100 - Math.round(value));
}

export function resolveThemeMode(themeMode: ThemeMode) {
  if (themeMode !== "system") {
    return themeMode;
  }

  if (typeof window === "undefined") {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyThemeMode(themeMode: ThemeMode) {
  const resolvedTheme = resolveThemeMode(themeMode);
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme;
  root.style.colorScheme = resolvedTheme;
  return resolvedTheme;
}

export function formatTrayStatus(
  latestSession: CodexSessionSummary | null | undefined,
  settings: AppSettings,
) {
  const fiveHourRemaining = getRemainingPercent(
    latestSession?.primaryRateLimit?.usedPercent,
  );
  const weeklyRemaining = getRemainingPercent(
    latestSession?.secondaryRateLimit?.usedPercent,
  );

  switch (settings.trayMetricMode) {
    case "five-hour":
      return fiveHourRemaining == null ? null : `5H ${fiveHourRemaining}`;
    case "weekly":
      return weeklyRemaining == null ? null : `W ${weeklyRemaining}`;
    case "both": {
      const parts = [
        fiveHourRemaining == null ? null : `5H ${fiveHourRemaining}`,
        weeklyRemaining == null ? null : `W ${weeklyRemaining}`,
      ].filter(Boolean);

      return parts.length ? parts.join(" ") : null;
    }
    default:
      return null;
  }
}
