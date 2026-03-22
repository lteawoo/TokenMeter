import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CodexOverview, CodexSessionSummary, UsageTotals } from "@tokenmeter/core";

import App from "./App";

const getCodexOverviewMock = vi.hoisted(() => vi.fn());
const getRuntimeKindMock = vi.hoisted(() => vi.fn());
const openDashboardViewMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/codex-overview", () => ({
  getCodexOverview: getCodexOverviewMock,
  getRuntimeKind: getRuntimeKindMock,
  openDashboardView: openDashboardViewMock,
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

describe("App workspace scope selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCodexOverviewMock.mockResolvedValue(overview);
    getRuntimeKindMock.mockReturnValue("web");
    window.history.replaceState({}, "", "/");
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
});
