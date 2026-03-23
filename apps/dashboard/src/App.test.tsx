import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CodexOverview, CodexSessionSummary, UsageTotals } from "@tokenmeter/core";
import type { AppSettings } from "@/lib/app-settings";
import type { AppUpdateState } from "@/lib/app-updates";

import App from "./App";

const getCodexOverviewMock = vi.hoisted(() => vi.fn());
const checkForAppUpdatesMock = vi.hoisted(() => vi.fn());
const getAppUpdateStateMock = vi.hoisted(() => vi.fn());
const getDesktopWindowVisibilityMock = vi.hoisted(() => vi.fn());
const getRuntimeKindMock = vi.hoisted(() => vi.fn());
const getAppSettingsMock = vi.hoisted(() => vi.fn());
const listenForAppUpdateStateChangesMock = vi.hoisted(() => vi.fn());
const listenForAppSettingsUpdatesMock = vi.hoisted(() => vi.fn());
const listenForDesktopWindowVisibilityMock = vi.hoisted(() => vi.fn());
const openExternalUrlMock = vi.hoisted(() => vi.fn());
const openDashboardViewMock = vi.hoisted(() => vi.fn());
const openDashboardSettingsViewMock = vi.hoisted(() => vi.fn());
const saveAppSettingsMock = vi.hoisted(() => vi.fn());

let settingsUpdateListener:
  | ((settings: AppSettings) => void)
  | null = null;
let desktopWindowVisibilityListener:
  | ((visible: boolean) => void)
  | null = null;
let documentVisibilityState: DocumentVisibilityState = "visible";

vi.mock("@/lib/codex-overview", () => ({
  checkForAppUpdates: checkForAppUpdatesMock,
  getCodexOverview: getCodexOverviewMock,
  getAppUpdateState: getAppUpdateStateMock,
  getDesktopWindowVisibility: getDesktopWindowVisibilityMock,
  getAppSettings: getAppSettingsMock,
  getRuntimeKind: getRuntimeKindMock,
  listenForAppUpdateStateChanges: listenForAppUpdateStateChangesMock,
  listenForAppSettingsUpdates: listenForAppSettingsUpdatesMock,
  listenForDesktopWindowVisibility: listenForDesktopWindowVisibilityMock,
  openExternalUrl: openExternalUrlMock,
  openDashboardView: openDashboardViewMock,
  openDashboardSettingsView: openDashboardSettingsViewMock,
  saveAppSettings: saveAppSettingsMock,
}));

vi.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ChartLegend: () => null,
  ChartLegendContent: () => null,
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}));

vi.mock("recharts", () => ({
  AreaChart: ({ data }: { data: unknown }) => (
    <div data-chart={JSON.stringify(data)} data-testid="area-chart" />
  ),
  BarChart: ({ data }: { data: unknown }) => (
    <div data-chart={JSON.stringify(data)} data-testid="bar-chart" />
  ),
  Area: () => null,
  Bar: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

function createUsageTotals(totalTokens: number): UsageTotals {
  return {
    inputTokens: totalTokens,
    cachedInputTokens: 0,
    outputTokens: Math.floor(totalTokens / 10),
    reasoningOutputTokens: Math.floor(totalTokens / 20),
    totalTokens,
  };
}

function createSession(
  overrides: Partial<CodexSessionSummary> & Pick<CodexSessionSummary, "id" | "cwd" | "updatedAt">,
): CodexSessionSummary {
  return {
    id: overrides.id,
    filePath: `/tmp/${overrides.id}.jsonl`,
    fileName: `${overrides.id}.jsonl`,
    model: "gpt-5.4",
    effort: "high",
    cwd: overrides.cwd,
    updatedAt: overrides.updatedAt,
    totalUsage: overrides.totalUsage ?? createUsageTotals(1000),
    lastUsage: overrides.lastUsage ?? createUsageTotals(100),
    primaryRateLimit: overrides.primaryRateLimit ?? {
      usedPercent: 10,
      windowMinutes: 300,
      resetsAt: "2026-03-22T12:00:00.000Z",
    },
    secondaryRateLimit: overrides.secondaryRateLimit ?? {
      usedPercent: 20,
      windowMinutes: 10080,
      resetsAt: "2026-03-25T12:00:00.000Z",
    },
    status: overrides.status ?? "idle",
  };
}

const overview: CodexOverview = {
  provider: "codex",
  generatedAt: "2026-03-22T08:40:00.000Z",
  sessionsDir: "/Users/twlee/.codex/sessions",
  sessions: [
    createSession({
      id: "projects-1",
      cwd: "/Users/twlee/projects",
      updatedAt: "2026-03-22T08:39:00.000Z",
      totalUsage: createUsageTotals(4000),
      lastUsage: createUsageTotals(400),
      status: "active",
    }),
    createSession({
      id: "memeplate-1",
      cwd: "/Users/twlee/projects/memeplate",
      updatedAt: "2026-03-22T08:37:00.000Z",
      totalUsage: createUsageTotals(2000),
      lastUsage: createUsageTotals(200),
      status: "active",
    }),
    createSession({
      id: "memeplate-2",
      cwd: "/Users/twlee/projects/memeplate",
      updatedAt: "2026-03-22T08:35:00.000Z",
      totalUsage: createUsageTotals(1500),
      lastUsage: createUsageTotals(150),
    }),
    createSession({
      id: "skills-1",
      cwd: "/Users/twlee/projects/my-skills",
      updatedAt: "2026-03-22T08:33:00.000Z",
      totalUsage: createUsageTotals(900),
      lastUsage: createUsageTotals(90),
    }),
  ],
  latestSession: null,
  totals: createUsageTotals(8400),
  lastTurnTotals: createUsageTotals(840),
};

overview.latestSession = overview.sessions[0];

function setDocumentVisibilityState(nextState: DocumentVisibilityState) {
  documentVisibilityState = nextState;
  document.dispatchEvent(new Event("visibilitychange"));
}

function emitDesktopWindowVisibility(visible: boolean) {
  desktopWindowVisibilityListener?.(visible);
}

const desktopSettings = {
  codexRootPath: "/Users/twlee/.codex",
  themeMode: "light" as const,
  trayMetricMode: "both" as const,
  trayPresentationMode: "text-only" as const,
};

const latestAppUpdateState: AppUpdateState = {
  status: "latest",
  currentVersion: "0.1.2",
  latestVersion: "0.1.2",
  releaseUrl: "https://github.com/lteawoo/TokenMeter/releases/tag/v0.1.2",
  checkedAt: "2026-03-22T08:30:00.000Z",
  message: null,
  homebrewUpgradeCommand: "brew update && brew upgrade --cask tokenmeter",
};

describe("App workspace scope selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCodexOverviewMock.mockResolvedValue(overview);
    checkForAppUpdatesMock.mockResolvedValue(latestAppUpdateState);
    getAppUpdateStateMock.mockResolvedValue(latestAppUpdateState);
    getDesktopWindowVisibilityMock.mockResolvedValue(true);
    getAppSettingsMock.mockResolvedValue(desktopSettings);
    getRuntimeKindMock.mockReturnValue("web");
    openExternalUrlMock.mockResolvedValue(undefined);
    saveAppSettingsMock.mockImplementation(async (settings) => settings);
    settingsUpdateListener = null;
    desktopWindowVisibilityListener = null;
    documentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => documentVisibilityState,
    });
    listenForAppSettingsUpdatesMock.mockImplementation(async (listener) => {
      settingsUpdateListener = listener;
      return () => {
        settingsUpdateListener = null;
      };
    });
    listenForAppUpdateStateChangesMock.mockImplementation(async (listener) => {
      return () => {
        void listener;
      };
    });
    listenForDesktopWindowVisibilityMock.mockImplementation(async (_view, listener) => {
      desktopWindowVisibilityListener = listener;
      return () => {
        desktopWindowVisibilityListener = null;
      };
    });
    openDashboardSettingsViewMock.mockResolvedValue(undefined);
    window.history.replaceState({}, "", "/");
    document.documentElement.dataset.theme = "dark";
  });

  it("filters dashboard summaries, charts, and session ledger by selected workspace", async () => {
    render(<App />);

    expect(screen.getByText("v0.1.4 · CHECK UPDATES")).toBeInTheDocument();

    const memeplateRadio = await screen.findByRole("radio", {
      name: /projects\/memeplate/i,
    });
    fireEvent.click(memeplateRadio);

    await waitFor(() => {
      expect(screen.getByText("Sessions: 2")).toBeInTheDocument();
    });

    expect(memeplateRadio).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Scope: projects/memeplate")).toBeInTheDocument();
    expect(screen.getAllByText("3,500").length).toBeGreaterThan(0);

    const areaChart = screen.getByTestId("area-chart");
    const barChart = screen.getByTestId("bar-chart");
    expect(areaChart.dataset.chart).toContain("projects/memeplate");
    expect(areaChart.dataset.chart).not.toContain("projects/my-skills");
    expect(barChart.dataset.chart).toContain("projects/memeplate");
    expect(barChart.dataset.chart).not.toContain("my-skills");

    const sessionsTab = screen.getByRole("tab", { name: "Sessions" });
    fireEvent.mouseDown(sessionsTab);
    fireEvent.click(sessionsTab);

    await waitFor(() => {
      expect(sessionsTab).toHaveAttribute("aria-selected", "true");
    });

    expect(screen.getAllByText("/Users/twlee/projects/memeplate").length).toBeGreaterThan(0);
    const ledgerTable = screen.getByRole("table");
    expect(within(ledgerTable).getAllByRole("row")).toHaveLength(3);
    expect(
      within(ledgerTable).queryByText("/Users/twlee/projects/my-skills"),
    ).not.toBeInTheDocument();
  });

  it("uses a narrow-width listbox selector in panel mode and keeps the active scope visible", async () => {
    getRuntimeKindMock.mockReturnValue("desktop");
    window.history.replaceState({}, "", "/?view=panel");

    render(<App />);

    const trigger = await screen.findByRole("button", {
      name: /all workspaces/i,
    });

    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const listbox = await screen.findByRole("listbox", {
      name: /workspace scope/i,
    });
    expect(listbox).toBeInTheDocument();

    const skillsOption = screen.getByRole("option", {
      name: /projects\/my-skills/i,
    });
    fireEvent.keyDown(skillsOption, { key: "Enter" });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /projects\/my-skills/i }),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("projects/my-skills · 1 session")).toBeInTheDocument();
    expect(screen.getByText("900")).toBeInTheDocument();
  });

  it("hydrates desktop settings, applies the light theme, and saves updated tray preferences", async () => {
    getRuntimeKindMock.mockReturnValue("desktop");

    render(<App />);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("light");
    });

    const [settingsButton] = await screen.findAllByRole("button", { name: "Settings" });
    fireEvent.click(settingsButton);

    fireEvent.click(screen.getByLabelText("5H"));

    const codexRootInput = screen.getByLabelText("Codex root");
    fireEvent.change(codexRootInput, {
      target: { value: "/Users/twlee/projects/.codex" },
    });

    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => {
      expect(saveAppSettingsMock).toHaveBeenCalledWith({
        codexRootPath: "/Users/twlee/projects/.codex",
        themeMode: "light",
        trayMetricMode: "five-hour",
        trayPresentationMode: "text-only",
      });
    });
  });

  it("routes the panel settings button to dashboard settings and the primary action to the dashboard", async () => {
    getRuntimeKindMock.mockReturnValue("desktop");
    window.history.replaceState({}, "", "/?view=panel");

    render(<App />);

    const dashboardButtons = await screen.findAllByRole("button", {
      name: /open dashboard/i,
    });
    fireEvent.click(dashboardButtons[0]);
    fireEvent.click(dashboardButtons[1]);

    expect(openDashboardSettingsViewMock).toHaveBeenCalledTimes(1);
    expect(openDashboardViewMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("updates the popover theme when desktop settings change in another window", async () => {
    getRuntimeKindMock.mockReturnValue("desktop");
    window.history.replaceState({}, "", "/?view=panel");

    render(<App />);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("light");
    });

    expect(settingsUpdateListener).not.toBeNull();

    settingsUpdateListener?.({
      ...desktopSettings,
      themeMode: "dark",
    });

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("dark");
    });
  });

  it("shows the desktop update status and actions inside settings", async () => {
    getRuntimeKindMock.mockReturnValue("desktop");

    render(<App />);

    const [settingsButton] = await screen.findAllByRole("button", { name: "Settings" });
    fireEvent.click(settingsButton);

    expect(await screen.findByText("LATEST")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /check for updates/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open latest release/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /homebrew upgrade/i })).toBeInTheDocument();
  });

  it("opens the GitHub repository from the dashboard header", async () => {
    render(<App />);

    const repositoryButton = await screen.findByRole("button", {
      name: /open github repository/i,
    });
    fireEvent.click(repositoryButton);

    await waitFor(() => {
      expect(openExternalUrlMock).toHaveBeenCalledWith(
        "https://github.com/lteawoo/TokenMeter",
      );
    });
  });

  it("polls the dashboard only while the document is visible", async () => {
    vi.useFakeTimers();
    try {
      render(<App />);

      await vi.advanceTimersByTimeAsync(0);
      expect(getCodexOverviewMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(15_000);
      expect(getCodexOverviewMock).toHaveBeenCalledTimes(2);

      setDocumentVisibilityState("hidden");
      await vi.advanceTimersByTimeAsync(45_000);

      expect(getCodexOverviewMock).toHaveBeenCalledTimes(2);

      setDocumentVisibilityState("visible");
      await vi.advanceTimersByTimeAsync(0);

      expect(getCodexOverviewMock).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(15_000);
      expect(getCodexOverviewMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("polls the desktop dashboard only while desktop visibility is true", async () => {
    getRuntimeKindMock.mockReturnValue("desktop");

    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");

    try {
      render(<App />);

      await waitFor(() => {
        expect(getCodexOverviewMock).toHaveBeenCalledTimes(1);
      });

      await waitFor(() => {
        expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 15_000);
      });

      const intervalHandle = setIntervalSpy.mock.results.at(-1)?.value;

      emitDesktopWindowVisibility(false);

      await waitFor(() => {
        expect(clearIntervalSpy).toHaveBeenCalledWith(intervalHandle);
      });

      emitDesktopWindowVisibility(true);

      await waitFor(() => {
        expect(setIntervalSpy).toHaveBeenLastCalledWith(expect.any(Function), 15_000);
      });
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  it("polls the compact panel only while desktop visibility is true", async () => {
    getRuntimeKindMock.mockReturnValue("desktop");
    window.history.replaceState({}, "", "/?view=panel");

    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");

    try {
      render(<App />);

      await waitFor(() => {
        expect(getCodexOverviewMock).toHaveBeenCalledTimes(1);
      });

      await waitFor(() => {
        expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
      });

      const intervalHandle = setIntervalSpy.mock.results.at(-1)?.value;

      emitDesktopWindowVisibility(false);

      await waitFor(() => {
        expect(clearIntervalSpy).toHaveBeenCalledWith(intervalHandle);
      });

      emitDesktopWindowVisibility(true);

      await waitFor(() => {
        expect(setIntervalSpy).toHaveBeenLastCalledWith(expect.any(Function), 60_000);
      });
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });
});
