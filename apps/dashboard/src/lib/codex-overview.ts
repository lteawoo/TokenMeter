import type { CodexOverview } from "@tokenmeter/core";

type CodexOverviewDataSource = {
  kind: "web" | "desktop";
  getOverview(limit?: number): Promise<CodexOverview>;
};

const DEFAULT_LIMIT = 12;
const TAURI_READY_TIMEOUT_MS = 2_000;
const TAURI_READY_POLL_MS = 25;

function hasTauriBridge() {
  const runtime = globalThis as typeof globalThis & {
    __TAURI_INTERNALS__?: unknown;
  };

  return typeof runtime.__TAURI_INTERNALS__ === "object";
}

function isDesktopRuntime() {
  if (import.meta.env.VITE_TOKENMETER_RUNTIME === "desktop") {
    return true;
  }

  const runtime = globalThis as typeof globalThis & { isTauri?: boolean };
  return Boolean(runtime.isTauri);
}

export async function waitForDesktopBridge() {
  if (!isDesktopRuntime()) {
    return false;
  }

  if (hasTauriBridge()) {
    return true;
  }

  const startedAt = Date.now();

  while (Date.now() - startedAt < TAURI_READY_TIMEOUT_MS) {
    await new Promise((resolve) => {
      window.setTimeout(resolve, TAURI_READY_POLL_MS);
    });

    if (hasTauriBridge()) {
      return true;
    }
  }

  return hasTauriBridge();
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
  const ready = await waitForDesktopBridge();
  if (!ready) {
    return webDataSource;
  }

  const { invoke } = await import("@tauri-apps/api/core");

  return {
    kind: "desktop",
    async getOverview(limit = DEFAULT_LIMIT) {
      return await invoke<CodexOverview>("get_codex_overview", { limit });
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

export async function openDashboardView() {
  if (isDesktopRuntime()) {
    const ready = await waitForDesktopBridge();

    if (ready) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("show_dashboard_window");
      return;
    }
  }

  const url = new URL(window.location.href);
  url.searchParams.set("view", "dashboard");
  window.location.href = url.toString();
}
