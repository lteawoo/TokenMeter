import {
  useCallback,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CodexOverview, CodexSessionSummary } from "@tokenmeter/core";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Bot,
  Clock3,
  FolderCode,
  Gauge,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettingsSheet } from "@/components/settings-sheet";
import {
  DashboardWorkspaceSelector,
  PanelWorkspaceSelector,
} from "@/components/workspace-scope-selectors";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  applyThemeMode,
  formatTrayStatus,
} from "@/lib/app-settings";
import {
  getCodexOverview,
  getAppSettings,
  getRuntimeKind,
  listenForAppSettingsUpdates,
  openDashboardView,
  openDashboardSettingsView,
  saveAppSettings,
  syncTrayStatus,
} from "@/lib/codex-overview";
import {
  ALL_WORKSPACES_VALUE,
  buildWorkspaceScopeSummaries,
  getWorkspaceLabel,
  getWorkspaceValue,
} from "@/lib/workspace-scope";

function formatNumber(value: number | null | undefined) {
  return (value ?? 0).toLocaleString();
}

function formatCompactTokenNumber(value: number | null | undefined) {
  const numericValue = value ?? 0;
  const absValue = Math.abs(numericValue);

  if (absValue >= 1_000_000) {
    const compactValue = numericValue / 1_000_000;
    return `${compactValue >= 10 ? compactValue.toFixed(0) : compactValue.toFixed(1)}M`;
  }

  if (absValue >= 1_000) {
    const compactValue = numericValue / 1_000;
    return `${compactValue >= 10 ? compactValue.toFixed(0) : compactValue.toFixed(1)}K`;
  }

  return numericValue.toLocaleString();
}

function formatPercent(value: number | null | undefined) {
  return `${Math.round(value ?? 0)}%`;
}

function formatRemainingPercent(value: number | null | undefined) {
  return `${Math.max(0, 100 - Math.round(value ?? 0))}%`;
}

function formatSharePercent(value: number | null | undefined) {
  return `${(value ?? 0).toFixed(1)}%`;
}

function getRemainingPercent(value: number | null | undefined) {
  return Math.max(0, 100 - Math.round(value ?? 0));
}

function formatTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatModelLabel(session: Pick<CodexSessionSummary, "model" | "effort"> | null) {
  if (!session?.model) {
    return "-";
  }

  if (!session.effort) {
    return session.model;
  }

  return `${session.model} · ${session.effort}`;
}

function getDesktopView() {
  if (typeof window === "undefined") {
    return "dashboard";
  }

  return new URLSearchParams(window.location.search).get("view") ?? "dashboard";
}

function shouldOpenSettingsFromQuery() {
  if (typeof window === "undefined") {
    return false;
  }

  return new URLSearchParams(window.location.search).get("settings") === "1";
}

function getProviderLabel(provider: CodexOverview["provider"] | null | undefined) {
  if (!provider) {
    return "Codex";
  }

  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

const LOGO_ICON_SRC = "/logo-icon.png";

function CompactStatTile({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-secondary/30 px-3 py-3">
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 font-mono text-lg font-semibold text-foreground">
        {value}
      </p>
    </div>
  );
}

type StatCardProps = {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
};

function StatCard({ icon, label, value, detail }: StatCardProps) {
  return (
    <Card className="border-border/70 bg-card/80 backdrop-blur">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div className="space-y-1">
          <CardDescription>{label}</CardDescription>
          <CardTitle className="font-mono text-3xl tracking-tight">
            {value}
          </CardTitle>
        </div>
        <div className="rounded-full border border-border/70 bg-secondary/70 p-2.5 text-accent">
          {icon}
        </div>
      </CardHeader>
      <CardContent className="pt-0 text-sm text-muted-foreground">
        {detail}
      </CardContent>
    </Card>
  );
}

type CompactMetricProps = {
  label: string;
  value: string;
};

function CompactMetric({ label, value }: CompactMetricProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-secondary/20 px-3 py-2.5">
      <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <span className="max-w-[11rem] truncate text-right font-mono text-xs font-semibold text-foreground">
        {value}
      </span>
    </div>
  );
}

function SessionDetailRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/50 py-3 last:border-b-0">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <div className="min-w-0 text-right font-mono text-sm font-medium text-foreground">
        {value}
      </div>
    </div>
  );
}

const ZERO_USAGE_TOTALS: CodexOverview["totals"] = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
};

function addUsageTotals(
  left: CodexOverview["totals"],
  right: CodexSessionSummary["totalUsage"] | CodexSessionSummary["lastUsage"],
) {
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

function App() {
  const [overview, setOverview] = useState<CodexOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [selectedWorkspace, setSelectedWorkspace] = useState(ALL_WORKSPACES_VALUE);
  const runtimeKind = getRuntimeKind();
  const desktopView = getDesktopView();
  const openSettingsFromQuery = shouldOpenSettingsFromQuery();
  const isDesktop = runtimeKind === "desktop";
  const isDesktopPanel = isDesktop && desktopView === "panel";
  const overviewRef = useRef<CodexOverview | null>(null);
  const requestInFlightRef = useRef(false);
  const settingsRef = useRef<AppSettings>(DEFAULT_APP_SETTINGS);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    const applyResolvedTheme = () => {
      applyThemeMode(settings.themeMode);
    };

    applyResolvedTheme();

    if (settings.themeMode !== "system") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", applyResolvedTheme);

    return () => {
      mediaQuery.removeEventListener("change", applyResolvedTheme);
    };
  }, [settings.themeMode]);

  const hydrateSettings = useCallback(async () => {
    if (!isDesktop) {
      setSettingsLoaded(true);
      return;
    }

    try {
      const payload = await getAppSettings();
      startTransition(() => {
        settingsRef.current = payload;
        setSettings(payload);
        setSettingsDraft(payload);
      });
    } catch (requestError) {
      startTransition(() => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Failed to load TokenMeter settings.",
        );
      });
    } finally {
      setSettingsLoaded(true);
    }
  }, [isDesktop]);

  const loadOverview = useCallback(async (settingsOverride?: AppSettings) => {
    if (requestInFlightRef.current) {
      return;
    }

    requestInFlightRef.current = true;
    const initialLoad = overviewRef.current === null;

    if (initialLoad) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const payload = await getCodexOverview();
      const activeSettings = settingsOverride ?? settingsRef.current;
      startTransition(() => {
        overviewRef.current = payload;
        setOverview(payload);
        setError(null);
      });

      if (isDesktop) {
        try {
          await syncTrayStatus(
            formatTrayStatus(payload.latestSession, activeSettings),
            activeSettings.trayPresentationMode,
          );
        } catch (traySyncError) {
          console.error("Failed to sync tray status.", traySyncError);
        }
      }
    } catch (requestError) {
      startTransition(() => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Failed to load TokenMeter data.",
        );
      });
    } finally {
      requestInFlightRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [isDesktop]);

  useEffect(() => {
    void hydrateSettings();
  }, [hydrateSettings]);

  useEffect(() => {
    if (!settingsOpen) {
      setSettingsDraft(settings);
    }
  }, [settings, settingsOpen]);

  useEffect(() => {
    if (!isDesktop) {
      return;
    }

    let cancelled = false;
    let detach: (() => void) | undefined;

    void listenForAppSettingsUpdates((nextSettings) => {
      if (cancelled) {
        return;
      }

      startTransition(() => {
        settingsRef.current = nextSettings;
        setSettings(nextSettings);
        if (!settingsOpen) {
          setSettingsDraft(nextSettings);
        }
      });
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }

      detach = unlisten;
    });

    return () => {
      cancelled = true;
      detach?.();
    };
  }, [isDesktop, settingsOpen]);

  useEffect(() => {
    if (isDesktopPanel || !openSettingsFromQuery) {
      return;
    }

    setSettingsDraft(settingsRef.current);
    setSettingsError(null);
    setSettingsOpen(true);

    const url = new URL(window.location.href);
    url.searchParams.delete("settings");
    window.history.replaceState({}, "", url.toString());
  }, [isDesktopPanel, openSettingsFromQuery]);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    void loadOverview();
    const intervalId = window.setInterval(() => {
      void loadOverview();
    }, isDesktopPanel ? 60000 : 15000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isDesktopPanel, loadOverview, settingsLoaded]);

  const handleSaveSettings = useCallback(
    async (nextSettings: AppSettings) => {
      setSettingsError(null);
      setSettingsSaving(true);

      try {
        const savedSettings = isDesktop
          ? await saveAppSettings(nextSettings)
          : nextSettings;

        startTransition(() => {
          settingsRef.current = savedSettings;
          setSettings(savedSettings);
        });

        await loadOverview(savedSettings);
        setSettingsOpen(false);
      } catch (requestError) {
        setSettingsError(
          requestError instanceof Error
            ? requestError.message
            : "Failed to save settings.",
        );
      } finally {
        setSettingsSaving(false);
      }
    },
    [isDesktop, loadOverview],
  );

  const sessions = overview?.sessions ?? [];
  const workspaceSummaries = useMemo(
    () => buildWorkspaceScopeSummaries(sessions),
    [sessions],
  );

  useEffect(() => {
    if (
      selectedWorkspace !== ALL_WORKSPACES_VALUE &&
      !workspaceSummaries.some((summary) => summary.value === selectedWorkspace)
    ) {
      setSelectedWorkspace(ALL_WORKSPACES_VALUE);
    }
  }, [selectedWorkspace, workspaceSummaries]);

  const filteredSessions = useMemo(() => {
    if (selectedWorkspace === ALL_WORKSPACES_VALUE) {
      return sessions;
    }

    return sessions.filter(
      (session) => getWorkspaceValue(session) === selectedWorkspace,
    );
  }, [selectedWorkspace, sessions]);

  const latest = filteredSessions[0] ?? null;
  const providerLabel = getProviderLabel(overview?.provider);
  const primaryRemaining = getRemainingPercent(latest?.primaryRateLimit?.usedPercent);
  const secondaryRemaining = getRemainingPercent(
    latest?.secondaryRateLimit?.usedPercent,
  );
  const filteredTotals = useMemo(
    () =>
      filteredSessions.reduce(
        (acc, session) => addUsageTotals(acc, session.totalUsage),
        ZERO_USAGE_TOTALS,
      ),
    [filteredSessions],
  );
  const filteredLastTurnTotals = useMemo(
    () =>
      filteredSessions.reduce(
        (acc, session) => addUsageTotals(acc, session.lastUsage),
        ZERO_USAGE_TOTALS,
      ),
    [filteredSessions],
  );
  const selectedWorkspaceSummary =
    selectedWorkspace === ALL_WORKSPACES_VALUE
      ? null
      : workspaceSummaries.find((summary) => summary.value === selectedWorkspace) ?? null;
  const selectedWorkspaceLabel =
    selectedWorkspace === ALL_WORKSPACES_VALUE
      ? "All workspaces"
      : selectedWorkspaceSummary?.label ??
        "Workspace";
  const selectedWorkspaceScopeDetail =
    selectedWorkspaceSummary === null
      ? `${workspaceSummaries.length} workspace${workspaceSummaries.length === 1 ? "" : "s"}`
      : `${selectedWorkspaceSummary.label} · ${selectedWorkspaceSummary.sessionCount} session${selectedWorkspaceSummary.sessionCount === 1 ? "" : "s"}`;

  const chartData = useMemo(
    () =>
      filteredSessions
        .slice(0, 8)
        .reverse()
        .map((session) => ({
          label: getWorkspaceLabel(getWorkspaceValue(session)),
          totalTokens: session.totalUsage?.totalTokens ?? 0,
          lastTurnTokens: session.lastUsage?.totalTokens ?? 0,
          lastTurnShare:
            (session.totalUsage?.totalTokens ?? 0) > 0
              ? (((session.lastUsage?.totalTokens ?? 0) /
                  (session.totalUsage?.totalTokens ?? 0)) *
                  100)
              : 0,
        })),
    [filteredSessions],
  );

  const chartConfig = {
    totalTokens: {
      label: "Session Total",
      color: "var(--chart-1)",
    },
    lastTurnShare: {
      label: "Last Turn Share",
      color: "var(--chart-2)",
    },
    lastTurnTokens: {
      label: "Last Turn",
      color: "var(--chart-2)",
    },
  } satisfies ChartConfig;

  if (isDesktopPanel) {
    return (
      <TooltipProvider delayDuration={120}>
        <main className="min-h-screen bg-transparent p-1.5">
          <div
            className="mx-auto flex min-h-[calc(100vh-0.75rem)] w-full max-w-md flex-col gap-2.5 rounded-[22px] border border-border/80 p-3 shadow-2xl shadow-black/20 backdrop-blur"
            style={{ background: "var(--panel-shell-background)" }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <img
                  alt="TokenMeter logo"
                  className="h-8 w-8 object-contain"
                  src={LOGO_ICON_SRC}
                />
                <div className="space-y-1">
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground">
                    TokenMeter
                  </p>
                  <Badge className="h-6 rounded-full bg-accent px-2 text-[10px] text-accent-foreground hover:bg-accent">
                    {providerLabel}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <p className="font-mono text-[11px] text-muted-foreground">
                  {formatTime(latest?.updatedAt ?? overview?.generatedAt)}
                </p>
                <Button
                  aria-label="Refresh"
                  className="h-8 w-8 rounded-xl border-border/80 bg-background/55"
                  onClick={() => {
                    void loadOverview();
                  }}
                  disabled={refreshing}
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  <RefreshCw
                    className={`size-4 ${refreshing ? "animate-spin" : ""}`}
                  />
                </Button>
              </div>
            </div>

            {error ? (
              <Card className="border-destructive/40 bg-destructive/10">
                <CardContent className="p-3 text-sm text-destructive">
                  {error}
                </CardContent>
              </Card>
            ) : null}

            {workspaceSummaries.length ? (
              <PanelWorkspaceSelector
                onSelect={setSelectedWorkspace}
                selectedValue={selectedWorkspace}
                summaries={workspaceSummaries}
                totalSessionCount={sessions.length}
              />
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <CompactStatTile
                label="5h left"
                value={`${primaryRemaining}%`}
              />
              <CompactStatTile
                label="Week left"
                value={`${secondaryRemaining}%`}
              />
              <CompactStatTile
                label="Input"
                value={formatNumber(filteredTotals.inputTokens)}
              />
              <CompactStatTile
                label="Output"
                value={formatNumber(filteredTotals.outputTokens)}
              />
            </div>

            <div className="grid gap-2">
              <CompactMetric label="Scope" value={selectedWorkspaceScopeDetail} />
              <CompactMetric label="Model" value={formatModelLabel(latest)} />
            </div>

            <div className="mt-auto flex items-center gap-2">
              <Button
                aria-label="Open dashboard"
                className="h-9 w-9 shrink-0 rounded-xl border-border/80 bg-background/55"
                onClick={() => {
                  void openDashboardSettingsView();
                }}
                size="icon"
                type="button"
                variant="outline"
              >
                <Settings2 className="size-4" />
              </Button>
              <Button
                className="h-9 flex-1 justify-between rounded-xl bg-accent px-3 font-mono text-accent-foreground hover:bg-accent/90"
                onClick={() => {
                  void openDashboardView();
                }}
              >
                Open Dashboard
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        </main>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={120}>
      <main
        className="min-h-screen px-4 py-6 md:px-8 md:py-8"
        style={{ background: "var(--app-shell-background)" }}
      >
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
          <section className="overflow-hidden rounded-3xl border border-border/70 bg-card/75 p-6 shadow-2xl shadow-black/20 backdrop-blur md:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl space-y-5">
                <div className="space-y-3">
                  <div className="flex items-center gap-4 md:gap-5">
                    <img
                      alt="TokenMeter logo"
                      className="h-11 w-11 shrink-0 object-contain md:h-14 md:w-14"
                      src={LOGO_ICON_SRC}
                    />
                    <h1 className="font-mono text-4xl font-semibold tracking-tight text-foreground md:text-6xl">
                      TokenMeter
                    </h1>
                  </div>
                  <p className="max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
                    Monitor local Codex activity in one place, including recent
                    session usage, plan-limit headroom, and token flow across
                    your active workspaces.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-accent text-accent-foreground hover:bg-accent">
                    Provider: Codex
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="bg-secondary/80 text-secondary-foreground"
                  >
                    Sessions: {formatNumber(filteredSessions.length)}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-border/80 bg-background/60"
                  >
                    Scope: {selectedWorkspaceLabel}
                  </Badge>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:w-[22rem]">
                <Card className="border-border/80 bg-secondary/60">
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className="rounded-full border border-border/80 bg-background/60 p-2 text-accent">
                      <ShieldCheck className="size-4" />
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                        5h plan limit
                      </p>
                      <p className="font-mono text-xl font-semibold">
                        {formatRemainingPercent(
                          latest?.primaryRateLimit?.usedPercent,
                        )}
                      </p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-border/80 bg-secondary/60">
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className="rounded-full border border-border/80 bg-background/60 p-2 text-accent">
                      <Clock3 className="size-4" />
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                        Weekly plan limit
                      </p>
                      <p className="font-mono text-xl font-semibold">
                        {formatRemainingPercent(
                          latest?.secondaryRateLimit?.usedPercent,
                        )}
                      </p>
                    </div>
                  </CardContent>
                </Card>
                <Button
                  variant="outline"
                  className="h-11 justify-between border-border/80 bg-background/55 font-mono sm:col-span-1"
                  onClick={() => {
                    void loadOverview();
                  }}
                  disabled={refreshing}
                >
                  Refresh
                  <RefreshCw
                    className={`size-4 ${refreshing ? "animate-spin" : ""}`}
                  />
                </Button>
                <Button
                  variant="outline"
                  className="h-11 justify-between border-border/80 bg-background/55 font-mono sm:col-span-1"
                  onClick={() => {
                    setSettingsDraft(settingsRef.current);
                    setSettingsError(null);
                    setSettingsOpen(true);
                  }}
                  type="button"
                >
                  Settings
                  <Settings2 className="size-4" />
                </Button>
              </div>
            </div>
            {workspaceSummaries.length ? (
              <DashboardWorkspaceSelector
                onSelect={setSelectedWorkspace}
                selectedValue={selectedWorkspace}
                summaries={workspaceSummaries}
                totalSessionCount={sessions.length}
              />
            ) : null}
          </section>

          {error ? (
            <Card className="border-destructive/40 bg-destructive/10">
              <CardContent className="flex items-center gap-3 p-4 text-sm text-destructive">
                <Activity className="size-4" />
                {error}
              </CardContent>
            </Card>
          ) : null}

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {loading && overview === null ? (
              Array.from({ length: 4 }, (_, index) => (
                <Card
                  className="border-border/70 bg-card/80 backdrop-blur"
                  key={index}
                >
                  <CardHeader className="space-y-3">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-10 w-32" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-3 w-40" />
                  </CardContent>
                </Card>
              ))
            ) : (
              <>
                <StatCard
                  icon={<Gauge className="size-4" />}
                  label="Total tokens"
                  value={formatNumber(filteredTotals.totalTokens)}
                  detail="Accumulated token volume across the tracked recent sessions."
                />
                <StatCard
                  icon={<Sparkles className="size-4" />}
                  label="Last turn tokens"
                  value={formatNumber(filteredLastTurnTotals.totalTokens)}
                  detail="Latest burst of token usage, useful for spotting context blowups."
                />
                <StatCard
                  icon={<ArrowDownToLine className="size-4" />}
                  label="Total input"
                  value={formatNumber(filteredTotals.inputTokens)}
                  detail="Summed input tokens across the tracked recent sessions."
                />
                <StatCard
                  icon={<ArrowUpFromLine className="size-4" />}
                  label="Total output"
                  value={formatNumber(filteredTotals.outputTokens)}
                  detail="Summed output tokens across the tracked recent sessions."
                />
                <StatCard
                  icon={<Bot className="size-4" />}
                  label="Latest model"
                  value={formatModelLabel(latest)}
                  detail="Most recently active model detected from the session logs."
                />
                <StatCard
                  icon={<FolderCode className="size-4" />}
                  label="Latest workspace"
                  value={latest ? getWorkspaceLabel(getWorkspaceValue(latest)) : "-"}
                  detail="Current working directory summary for the newest session."
                />
              </>
            )}
          </section>

          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList className="w-full justify-start overflow-x-auto overflow-y-hidden rounded-2xl bg-card/55">
              <TabsTrigger value="overview" className="font-mono">
                Overview
              </TabsTrigger>
              <TabsTrigger value="sessions" className="font-mono">
                Sessions
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <section className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
                <Card className="border-border/70 bg-card/80 backdrop-blur">
                  <CardHeader className="flex flex-row items-start justify-between space-y-0">
                    <div>
                      <CardTitle className="font-mono text-xl">
                        Usage flow
                      </CardTitle>
                      <CardDescription>
                        Session totals versus last-turn share by session.
                      </CardDescription>
                    </div>
                    <Badge
                      variant="outline"
                      className="border-border/80 bg-background/60 font-mono text-xs"
                    >
                      last 8 sessions
                    </Badge>
                  </CardHeader>
                  <CardContent>
                    {chartData.length ? (
                      <ChartContainer
                        config={chartConfig}
                        className="h-[320px] w-full"
                      >
                        <AreaChart data={chartData}>
                          <defs>
                            <linearGradient
                              id="fillTotalTokens"
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="5%"
                                stopColor="var(--color-totalTokens)"
                                stopOpacity={0.34}
                              />
                              <stop
                                offset="95%"
                                stopColor="var(--color-totalTokens)"
                                stopOpacity={0}
                              />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} />
                          <YAxis
                            axisLine={false}
                            tickLine={false}
                            tickMargin={12}
                            width={72}
                            tickFormatter={(value) =>
                              formatCompactTokenNumber(Number(value))
                            }
                            yAxisId="tokens"
                          />
                          <YAxis
                            axisLine={false}
                            orientation="right"
                            tickLine={false}
                            tickMargin={12}
                            tickFormatter={(value) =>
                              formatSharePercent(Number(value))
                            }
                            width={52}
                            yAxisId="share"
                          />
                          <XAxis
                            axisLine={false}
                            dataKey="label"
                            minTickGap={24}
                            tickLine={false}
                            tickMargin={12}
                          />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                indicator="line"
                                formatter={(value, name, item) => (
                                  <>
                                    <div
                                      className="w-1 shrink-0 rounded-[2px]"
                                      style={{
                                        backgroundColor:
                                          item.payload.fill ?? item.color ?? "currentColor",
                                      }}
                                    />
                                    <div className="flex flex-1 items-center justify-between leading-none">
                                      <span className="text-muted-foreground">
                                        {name}
                                      </span>
                                      <span className="font-mono font-medium tabular-nums text-foreground">
                                        {name === "Last Turn Share"
                                          ? formatSharePercent(Number(value))
                                          : formatNumber(Number(value))}
                                      </span>
                                    </div>
                                  </>
                                )}
                              />
                            }
                          />
                          <ChartLegend content={<ChartLegendContent />} />
                          <Area
                            dataKey="totalTokens"
                            fill="url(#fillTotalTokens)"
                            fillOpacity={1}
                            stroke="var(--color-totalTokens)"
                            strokeWidth={2}
                            type="monotone"
                            yAxisId="tokens"
                          />
                          <Area
                            dataKey="lastTurnShare"
                            fillOpacity={0}
                            stroke="var(--color-lastTurnShare)"
                            strokeDasharray="6 4"
                            strokeWidth={2}
                            type="monotone"
                            yAxisId="share"
                          />
                        </AreaChart>
                      </ChartContainer>
                    ) : (
                      <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
                        No recent chartable sessions found.
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border/70 bg-card/80 backdrop-blur">
                  <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                    <div>
                      <CardTitle className="font-mono text-xl">
                        Latest session
                      </CardTitle>
                      <CardDescription>
                        Highest signal details from the most recent run.
                      </CardDescription>
                    </div>
                    <Badge
                      className={
                        latest?.status === "active"
                          ? "bg-accent text-accent-foreground hover:bg-accent"
                          : "bg-secondary text-secondary-foreground"
                      }
                    >
                      {latest?.status ?? "none"}
                    </Badge>
                  </CardHeader>
                  <CardContent>
                    {latest ? (
                      <div className="rounded-2xl border border-border/70 bg-background/35 px-4">
                        <SessionDetailRow
                          label="Model"
                          value={formatModelLabel(latest)}
                        />
                        <SessionDetailRow
                          label="Updated"
                          value={formatTime(latest.updatedAt)}
                        />
                        <SessionDetailRow
                          label="Last turn"
                          value={formatNumber(latest.lastUsage?.totalTokens)}
                        />
                        <SessionDetailRow
                          label="Session total"
                          value={formatNumber(latest.totalUsage?.totalTokens)}
                        />
                        <SessionDetailRow
                          label="Workspace"
                          value={
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <p className="max-w-[15rem] truncate text-right">
                                  {getWorkspaceValue(latest)}
                                </p>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-sm font-mono text-xs">
                                {getWorkspaceValue(latest)}
                              </TooltipContent>
                            </Tooltip>
                          }
                        />
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        No recent session detected yet.
                      </div>
                    )}
                  </CardContent>
                </Card>
              </section>

              <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                <Card className="border-border/70 bg-card/80 backdrop-blur">
                  <CardHeader>
                    <CardTitle className="font-mono text-xl">
                      Recent session comparison
                    </CardTitle>
                    <CardDescription>
                      Horizontal scan of session totals for quick ranking.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {chartData.length ? (
                      <ChartContainer
                        config={chartConfig}
                        className="h-[280px] w-full"
                      >
                        <BarChart data={chartData}>
                          <CartesianGrid vertical={false} />
                          <YAxis
                            axisLine={false}
                            tickLine={false}
                            tickMargin={12}
                            width={56}
                            tickFormatter={(value) =>
                              formatCompactTokenNumber(Number(value))
                            }
                          />
                          <XAxis
                            axisLine={false}
                            dataKey="label"
                            minTickGap={24}
                            tickLine={false}
                            tickMargin={12}
                          />
                          <ChartTooltip
                            content={<ChartTooltipContent indicator="dashed" />}
                          />
                          <Bar
                            dataKey="lastTurnTokens"
                            fill="var(--color-lastTurnTokens)"
                            radius={8}
                          />
                        </BarChart>
                      </ChartContainer>
                    ) : (
                      <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
                        No session comparison data available.
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border/70 bg-card/80 backdrop-blur">
                  <CardHeader>
                    <CardTitle className="font-mono text-xl">
                      Token mix
                    </CardTitle>
                    <CardDescription>
                      Core token composition across the tracked sessions.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    {[
                      ["Input", filteredTotals.inputTokens],
                      ["Cached input", filteredTotals.cachedInputTokens],
                      ["Output", filteredTotals.outputTokens],
                      [
                        "Reasoning output",
                        filteredTotals.reasoningOutputTokens,
                      ],
                    ].map(([label, value]) => (
                      <div
                        className="flex items-center justify-between rounded-2xl border border-border/70 bg-secondary/45 px-4 py-3"
                        key={label}
                      >
                        <span className="text-sm text-muted-foreground">
                          {label}
                        </span>
                        <span className="font-mono text-base font-semibold">
                          {formatNumber(value as number | null | undefined)}
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </section>
            </TabsContent>

            <TabsContent value="sessions">
              <Card className="border-border/70 bg-card/80 backdrop-blur">
                <CardHeader className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <CardTitle className="font-mono text-xl">
                      Session ledger
                    </CardTitle>
                    <CardDescription>
                      Structured view using shadcn Table instead of layout div
                      grids.
                    </CardDescription>
                  </div>
                  <Badge
                    variant="outline"
                    className="w-fit border-border/80 bg-background/60 font-mono text-xs"
                  >
                    updated every 15 seconds
                  </Badge>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Workspace</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Last turn</TableHead>
                        <TableHead className="text-right">Session total</TableHead>
                        <TableHead className="text-right">Primary usage</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredSessions.length ? (
                        filteredSessions.map((session) => (
                          <TableRow key={session.id}>
                            <TableCell className="max-w-[18rem]">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div>
                                    <p className="truncate font-medium text-foreground">
                                      {getWorkspaceLabel(getWorkspaceValue(session))}
                                    </p>
                                    <p className="truncate font-mono text-xs text-muted-foreground">
                                      {getWorkspaceValue(session)}
                                    </p>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-sm font-mono text-xs">
                                  {getWorkspaceValue(session)}
                                </TooltipContent>
                              </Tooltip>
                            </TableCell>
                            <TableCell className="font-mono">
                              {formatModelLabel(session)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                className={
                                  session.status === "active"
                                    ? "bg-accent text-accent-foreground hover:bg-accent"
                                    : "bg-secondary text-secondary-foreground"
                                }
                              >
                                {session.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatNumber(session.lastUsage?.totalTokens)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatNumber(session.totalUsage?.totalTokens)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatPercent(session.primaryRateLimit?.usedPercent)}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell
                            className="h-24 text-center text-muted-foreground"
                            colSpan={6}
                          >
                            No sessions found for the selected workspace.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      <SettingsSheet
        error={settingsError}
        onChange={setSettingsDraft}
        onClose={() => {
          setSettingsOpen(false);
          setSettingsError(null);
        }}
        onSave={handleSaveSettings}
        open={settingsOpen}
        runtimeKind={runtimeKind}
        saving={settingsSaving}
        settings={settingsDraft}
      />
      </main>
    </TooltipProvider>
  );
}

export default App;
