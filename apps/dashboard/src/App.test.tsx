import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CodexOverview, CodexSessionSummary, UsageTotals } from "@tokenmeter/core";
import type { AppSettings } from "@/lib/app-settings";

import App from "./App";

const getCodexOverviewMock = vi.hoisted(() => vi.fn());
const getRuntimeKindMock = vi.hoisted(() => vi.fn());
const getAppSettingsMock = vi.hoisted(() => vi.fn());
const listenForAppSettingsUpdatesMock = vi.hoisted(() => vi.fn());
const openDashboardViewMock = vi.hoisted(() => vi.fn());
const openDashboardSettingsViewMock = vi.hoisted(() => vi.fn());
const saveAppSettingsMock = vi.hoisted(() => vi.fn());
const syncTrayStatusMock = vi.hoisted(() => vi.fn());

let settingsUpdateListener:
  | ((settings: AppSettings) => void)
  | null = null;

vi.mock("@/lib/codex-overview", () => ({
  getCodexOverview: getCodexOverviewMock,
  getAppSettings: getAppSettingsMock,
  getRuntimeKind: getRuntimeKindMock,
  listenForAppSettingsUpdates: listenForAppSettingsUpdatesMock,
  openDashboardView: openDashboardViewMock,
  openDashboardSettingsView: openDashboardSettingsViewMock,
  saveAppSettings: saveAppSettingsMock,
  syncTrayStatus: syncTrayStatusMock,
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

const desktopSettings = {
  codexRootPath: "/Users/twlee/.codex/sessions",
  themeMode: "light" as const,
  trayMetricMode: "both" as const,
  trayPresentationMode: "text-only" as const,
};

describe("App workspace scope selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCodexOverviewMock.mockResolvedValue(overview);
    getAppSettingsMock.mockResolvedValue(desktopSettings);
    getRuntimeKindMock.mockReturnValue("web");
    saveAppSettingsMock.mockImplementation(async (settings) => settings);
    syncTrayStatusMock.mockResolvedValue(undefined);
    settingsUpdateListener = null;
    listenForAppSettingsUpdatesMock.mockImplementation(async (listener) => {
      settingsUpdateListener = listener;
      return () => {
        settingsUpdateListener = null;
      };
    });
    openDashboardSettingsViewMock.mockResolvedValue(undefined);
    window.history.replaceState({}, "", "/");
    document.documentElement.dataset.theme = "dark";
  });

  it("filters dashboard summaries, charts, and session ledger by selected workspace", async () => {
    render(<App />);

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
    expect(syncTrayStatusMock).not.toHaveBeenCalled();
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

    expect(syncTrayStatusMock).toHaveBeenCalledWith("5H 90 W 80", "text-only");
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
      target: { value: "/Users/twlee/projects/.codex/sessions" },
    });

    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => {
      expect(saveAppSettingsMock).toHaveBeenCalledWith({
        codexRootPath: "/Users/twlee/projects/.codex/sessions",
        themeMode: "light",
        trayMetricMode: "five-hour",
        trayPresentationMode: "text-only",
      });
    });

    await waitFor(() => {
      expect(syncTrayStatusMock).toHaveBeenLastCalledWith("5H 90", "text-only");
    });
  });

  it("keeps the overview visible when tray sync fails on desktop", async () => {
    getRuntimeKindMock.mockReturnValue("desktop");
    syncTrayStatusMock.mockRejectedValue(new Error("tray unavailable"));

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("TokenMeter")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getAllByText("8,400").length).toBeGreaterThan(0);
    });

    expect(screen.queryByText("Failed to load TokenMeter data.")).not.toBeInTheDocument();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to sync tray status.",
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
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
});
