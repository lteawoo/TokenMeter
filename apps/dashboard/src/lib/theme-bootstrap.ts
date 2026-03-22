import { DEFAULT_APP_SETTINGS, applyThemeMode, type AppSettings } from "@/lib/app-settings";
import { getAppSettings, getRuntimeKind } from "@/lib/codex-overview";

type BootstrapThemeDependencies = {
  getRuntimeKind?: () => "web" | "desktop";
  loadDesktopSettings?: () => Promise<AppSettings>;
};

export async function bootstrapDocumentTheme({
  getRuntimeKind: getRuntimeKindOverride = getRuntimeKind,
  loadDesktopSettings = getAppSettings,
}: BootstrapThemeDependencies = {}) {
  if (getRuntimeKindOverride() !== "desktop") {
    return applyThemeMode(DEFAULT_APP_SETTINGS.themeMode);
  }

  try {
    const settings = await loadDesktopSettings();
    return applyThemeMode(settings.themeMode);
  } catch {
    return applyThemeMode(DEFAULT_APP_SETTINGS.themeMode);
  }
}
