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
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  getCodexOverview,
  getRuntimeKind,
  openDashboardView,
} from "@/lib/codex-overview";

function formatNumber(value: number | null | undefined) {
  return (value ?? 0).toLocaleString();
}

function formatPercent(value: number | null | undefined) {
  return `${Math.round(value ?? 0)}%`;
}

function formatRemainingPercent(value: number | null | undefined) {
  return `${Math.max(0, 100 - Math.round(value ?? 0))}%`;
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

function sessionLabel(session: CodexSessionSummary) {
  return (
    session.cwd?.split("/").filter(Boolean).slice(-2).join("/") ??
    session.fileName
  );
}

function sessionWorkspace(session: CodexSessionSummary) {
  return session.cwd ?? session.filePath;
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

function getProviderLabel(provider: CodexOverview["provider"] | null | undefined) {
  if (!provider) {
    return "Codex";
  }

  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

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
  const [selectedWorkspace, setSelectedWorkspace] = useState("all");
  const runtimeKind = getRuntimeKind();
  const desktopView = getDesktopView();
  const isDesktop = runtimeKind === "desktop";
  const isDesktopPanel = isDesktop && desktopView === "panel";
  const overviewRef = useRef<CodexOverview | null>(null);
  const requestInFlightRef = useRef(false);

  const loadOverview = useCallback(async () => {
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
      startTransition(() => {
        overviewRef.current = payload;
        setOverview(payload);
        setError(null);
      });
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
  }, []);

  useEffect(() => {
    void loadOverview();
    const intervalId = window.setInterval(() => {
      void loadOverview();
    }, isDesktopPanel ? 60000 : 15000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isDesktopPanel, loadOverview]);

  const sessions = overview?.sessions ?? [];
  const workspaceOptions = useMemo(() => {
    const seen = new Set<string>();

    return sessions
      .map((session) => ({
        value: sessionWorkspace(session),
        label: sessionLabel(session),
      }))
      .filter((option) => {
        if (seen.has(option.value)) {
          return false;
        }

        seen.add(option.value);
        return true;
      });
  }, [sessions]);

  useEffect(() => {
    if (
      selectedWorkspace !== "all" &&
      !workspaceOptions.some((option) => option.value === selectedWorkspace)
    ) {
      setSelectedWorkspace("all");
    }
  }, [selectedWorkspace, workspaceOptions]);

  const filteredSessions = useMemo(() => {
    if (selectedWorkspace === "all") {
      return sessions;
    }

    return sessions.filter(
      (session) => sessionWorkspace(session) === selectedWorkspace,
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
  const selectedWorkspaceLabel =
    selectedWorkspace === "all"
      ? "All workspaces"
      : workspaceOptions.find((option) => option.value === selectedWorkspace)?.label ??
        "Workspace";

  const chartData = useMemo(
    () =>
      filteredSessions
        .slice(0, 8)
        .reverse()
        .map((session) => ({
          label: sessionLabel(session),
          totalTokens: session.totalUsage?.totalTokens ?? 0,
          lastTurnTokens: session.lastUsage?.totalTokens ?? 0,
        })),
    [filteredSessions],
  );

  const chartConfig = {
    totalTokens: {
      label: "Session Total",
      color: "var(--chart-1)",
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
          <div className="mx-auto flex min-h-[calc(100vh-0.75rem)] w-full max-w-md flex-col gap-2.5 rounded-[22px] border border-border/80 bg-[#0b1410]/96 p-3 shadow-2xl shadow-black/40 backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <Badge className="h-7 rounded-full bg-accent px-2.5 text-[11px] text-accent-foreground hover:bg-accent">
                {providerLabel}
              </Badge>
              <p className="font-mono text-[11px] text-muted-foreground">
                {formatTime(latest?.updatedAt ?? overview?.generatedAt)}
              </p>
            </div>

            {error ? (
              <Card className="border-destructive/40 bg-destructive/10">
                <CardContent className="p-3 text-sm text-destructive">
                  {error}
                </CardContent>
              </Card>
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
                value={formatNumber(overview?.totals.inputTokens)}
              />
              <CompactStatTile
                label="Output"
                value={formatNumber(overview?.totals.outputTokens)}
              />
            </div>

            <div className="grid gap-2">
              <CompactMetric label="Model" value={formatModelLabel(latest)} />
              <CompactMetric label="Workspace" value={latest ? sessionLabel(latest) : "-"} />
            </div>

            <div className="mt-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-xl border-border/80 bg-background/55"
                onClick={() => {
                  void loadOverview();
                }}
                disabled={refreshing}
              >
                <RefreshCw
                  className={`size-4 ${refreshing ? "animate-spin" : ""}`}
                />
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
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.12),transparent_24%),radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_28%)] px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
          <section className="overflow-hidden rounded-3xl border border-border/70 bg-card/75 p-6 shadow-2xl shadow-black/20 backdrop-blur md:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl space-y-4">
                <div className="space-y-3">
                  <h1 className="font-mono text-4xl font-semibold tracking-tight text-foreground md:text-6xl">
                    TokenMeter
                  </h1>
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
                  className="col-span-full h-11 justify-between border-border/80 bg-background/55 font-mono"
                  onClick={() => {
                    void loadOverview();
                  }}
                  disabled={refreshing}
                >
                  Refresh dashboard
                  <RefreshCw
                    className={`size-4 ${refreshing ? "animate-spin" : ""}`}
                  />
                </Button>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button
                variant={selectedWorkspace === "all" ? "secondary" : "outline"}
                size="sm"
                className="rounded-full font-mono"
                onClick={() => {
                  setSelectedWorkspace("all");
                }}
              >
                All workspaces
              </Button>
              {workspaceOptions.map((option) => (
                <Button
                  key={option.value}
                  variant={
                    selectedWorkspace === option.value ? "secondary" : "outline"
                  }
                  size="sm"
                  className="rounded-full font-mono"
                  onClick={() => {
                    setSelectedWorkspace(option.value);
                  }}
                >
                  {option.label}
                </Button>
              ))}
            </div>
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
                  value={latest ? sessionLabel(latest) : "-"}
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
                        Recent session totals versus last-turn spikes.
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
                          <XAxis
                            axisLine={false}
                            dataKey="label"
                            minTickGap={24}
                            tickLine={false}
                            tickMargin={12}
                          />
                          <ChartTooltip
                            content={<ChartTooltipContent indicator="line" />}
                          />
                          <ChartLegend content={<ChartLegendContent />} />
                          <Area
                            dataKey="totalTokens"
                            fill="url(#fillTotalTokens)"
                            fillOpacity={1}
                            stroke="var(--color-totalTokens)"
                            strokeWidth={2}
                            type="monotone"
                          />
                          <Area
                            dataKey="lastTurnTokens"
                            fillOpacity={0}
                            stroke="var(--color-lastTurnTokens)"
                            strokeDasharray="6 4"
                            strokeWidth={2}
                            type="monotone"
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
                  <CardHeader>
                    <CardTitle className="font-mono text-xl">
                      Latest session
                    </CardTitle>
                    <CardDescription>
                      Highest signal details from the most recent run.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    {latest ? (
                      <>
                        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-secondary/50 p-4">
                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                              Status
                            </p>
                            <p className="mt-1 font-mono text-lg font-semibold">
                              {latest.status}
                            </p>
                          </div>
                          <Badge
                            className={
                              latest.status === "active"
                                ? "bg-accent text-accent-foreground hover:bg-accent"
                                : "bg-secondary text-secondary-foreground"
                            }
                          >
                            {latest.status}
                          </Badge>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                              Model
                            </p>
                            <p className="mt-2 font-mono text-lg font-semibold">
                              {formatModelLabel(latest)}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                              Updated
                            </p>
                            <p className="mt-2 font-mono text-lg font-semibold">
                              {formatTime(latest.updatedAt)}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                              Last turn
                            </p>
                            <p className="mt-2 font-mono text-lg font-semibold">
                              {formatNumber(latest.lastUsage?.totalTokens)}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                              Session total
                            </p>
                            <p className="mt-2 font-mono text-lg font-semibold">
                              {formatNumber(latest.totalUsage?.totalTokens)}
                            </p>
                          </div>
                        </div>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="rounded-2xl border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">
                              <p className="mb-2 text-xs uppercase tracking-[0.18em]">
                                Workspace
                              </p>
                              <p className="truncate font-mono text-foreground">
                                {sessionWorkspace(latest)}
                              </p>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-sm font-mono text-xs">
                            {sessionWorkspace(latest)}
                          </TooltipContent>
                        </Tooltip>
                      </>
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
                                      {sessionLabel(session)}
                                    </p>
                                    <p className="truncate font-mono text-xs text-muted-foreground">
                                      {sessionWorkspace(session)}
                                    </p>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-sm font-mono text-xs">
                                  {sessionWorkspace(session)}
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
      </main>
    </TooltipProvider>
  );
}

export default App;
