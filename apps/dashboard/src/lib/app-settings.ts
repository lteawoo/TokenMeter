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
