import type { CodexOverview } from "@tokenmeter/core";
import type { AppSettings } from "@/lib/app-settings";

export type DesktopWindowView = "dashboard" | "panel";

type CodexOverviewDataSource = {
  kind: "web" | "desktop";
  getOverview(limit?: number): Promise<CodexOverview>;
};

const DEFAULT_LIMIT = 12;
const TAURI_READY_TIMEOUT_MS = 5_000;
const TAURI_READY_POLL_MS = 25;
const DESKTOP_WINDOW_VISIBILITY_EVENT = "desktop-window-visibility-changed";

type DesktopWindowVisibilityPayload = {
  view: DesktopWindowView;
  visible: boolean;
};

function isDesktopRuntime() {
  const runtime = globalThis as typeof globalThis & {
    __TAURI__?: { core?: { invoke?: unknown } };
    __TAURI_INTERNALS__?: { invoke?: unknown };
    isTauri?: boolean;
  };

  if (
    typeof runtime.__TAURI__?.core?.invoke === "function" ||
    typeof runtime.__TAURI_INTERNALS__?.invoke === "function"
  ) {
    return true;
  }

  if (import.meta.env.VITE_TOKENMETER_RUNTIME === "desktop") {
    return true;
  }

  return Boolean(runtime.isTauri);
}

async function getDesktopInvoke() {
  const runtime = globalThis as typeof globalThis & {
    __TAURI__?: { core?: { invoke?: <T>(cmd: string, payload?: Record<string, unknown>) => Promise<T> } };
    __TAURI_INTERNALS__?: { invoke?: unknown };
  };

  if (typeof runtime.__TAURI__?.core?.invoke === "function") {
    return runtime.__TAURI__.core.invoke;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke;
}

const webDataSource: CodexOverviewDataSource = {
  kind: "web",
  async getOverview(limit = DEFAULT_LIMIT) {
    const response = await fetch(`/api/providers/codex/overview?limit=${limit}`);
    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }

    return (await response.json()) as CodexOverview;
  },
};

async function getDesktopDataSource(): Promise<CodexOverviewDataSource> {
  return {
    kind: "desktop",
    async getOverview(limit = DEFAULT_LIMIT) {
      return await invokeDesktop<CodexOverview>("get_codex_overview", { limit });
    },
  };
}

export async function getCodexOverview(limit = DEFAULT_LIMIT) {
  if (isDesktopRuntime()) {
    return (await getDesktopDataSource()).getOverview(limit);
  }

  return webDataSource.getOverview(limit);
}

export function getRuntimeKind() {
  return isDesktopRuntime() ? "desktop" : "web";
}

async function openDashboardRoute(openSettings = false) {
  if (isDesktopRuntime()) {
    try {
      await invokeDesktop("show_dashboard_window", { openSettings });
      return;
    } catch {
      // Fall through to the web-style navigation fallback below.
    }
  }

  const url = new URL(window.location.href);
  url.searchParams.set("view", "dashboard");
  if (openSettings) {
    url.searchParams.set("settings", "1");
  } else {
    url.searchParams.delete("settings");
  }
  window.location.href = url.toString();
}

export async function openDashboardView() {
  return openDashboardRoute(false);
}

export async function openDashboardSettingsView() {
  return openDashboardRoute(true);
}

async function invokeDesktop<T>(command: string, payload?: Record<string, unknown>) {
  if (!isDesktopRuntime()) {
    throw new Error("Desktop runtime is required for this command.");
  }

  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < TAURI_READY_TIMEOUT_MS) {
    try {
      const invoke = await getDesktopInvoke();
      return await invoke<T>(command, payload);
    } catch (error) {
      lastError = error;

      await new Promise((resolve) => {
        window.setTimeout(resolve, TAURI_READY_POLL_MS);
      });
    }
  }

  throw new Error(
    lastError instanceof Error ? lastError.message : "Tauri bridge is not ready.",
  );
}

export async function getAppSettings() {
  return invokeDesktop<AppSettings>("get_app_settings");
}

export async function saveAppSettings(settings: AppSettings) {
  return invokeDesktop<AppSettings>("save_app_settings", { settings });
}

export async function listenForAppSettingsUpdates(
  onUpdate: (settings: AppSettings) => void,
) {
  if (!isDesktopRuntime()) {
    return () => {};
  }

  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<AppSettings>("app-settings-updated", (event) => {
    onUpdate(event.payload);
  });

  return unlisten;
}

export async function getDesktopWindowVisibility() {
  if (!isDesktopRuntime()) {
    return true;
  }

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return await getCurrentWindow().isVisible();
}

export async function listenForDesktopWindowVisibility(
  view: DesktopWindowView,
  onUpdate: (visible: boolean) => void,
) {
  if (!isDesktopRuntime()) {
    return () => {};
  }

  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<DesktopWindowVisibilityPayload>(
    DESKTOP_WINDOW_VISIBILITY_EVENT,
    (event) => {
      if (event.payload.view === view) {
        onUpdate(event.payload.visible);
      }
    },
  );

  return unlisten;
}
