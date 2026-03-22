import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
} from "react";
import { Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ALL_WORKSPACES_VALUE,
  type WorkspaceScopeSummary,
} from "@/lib/workspace-scope";

const DASHBOARD_VISIBLE_WORKSPACES = 3;

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

function formatSessionCount(value: number) {
  return `${value} session${value === 1 ? "" : "s"}`;
}

function buildWorkspaceDescription(summary: WorkspaceScopeSummary) {
  const parts = [formatSessionCount(summary.sessionCount)];

  if (summary.hasActiveSession) {
    parts.push("Active");
  } else if (summary.isLatest) {
    parts.push("Latest");
  }

  parts.push(`Updated ${formatTime(summary.latestUpdatedAt)}`);

  return parts.join(" · ");
}

function moveFocusByArrowKey(
  event: ReactKeyboardEvent,
  values: string[],
  refs: MutableRefObject<Record<string, HTMLButtonElement | null>>,
  currentValue: string,
) {
  if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) {
    return;
  }

  event.preventDefault();

  const currentIndex = values.indexOf(currentValue);
  if (currentIndex === -1) {
    return;
  }

  let nextIndex = currentIndex;

  if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = values.length - 1;
  } else {
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    nextIndex = (currentIndex + direction + values.length) % values.length;
  }

  refs.current[values[nextIndex]]?.focus();
}

type DashboardWorkspaceSelectorProps = {
  summaries: WorkspaceScopeSummary[];
  selectedValue: string;
  onSelect: (value: string) => void;
  totalSessionCount: number;
};

function DashboardWorkspaceCard({
  title,
  description,
  detail,
  selected,
  value,
  onSelect,
  onKeyDown,
  buttonRef,
}: {
  title: string;
  description: string;
  detail: string;
  selected: boolean;
  value: string;
  onSelect: (value: string) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>, value: string) => void;
  buttonRef: (element: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={buttonRef}
      aria-checked={selected}
      className={cn(
        "group rounded-2xl border px-4 py-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        selected
          ? "border-accent/40 bg-accent/10 shadow-[0_0_0_1px_rgba(34,197,94,0.15)]"
          : "border-border/70 bg-secondary/30 hover:border-border hover:bg-secondary/45",
      )}
      onClick={() => {
        onSelect(value);
      }}
      onKeyDown={(event) => {
        onKeyDown(event, value);
      }}
      role="radio"
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-semibold text-foreground">
            {title}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        {selected ? (
          <span className="rounded-full border border-accent/30 bg-accent/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
            Active
          </span>
        ) : null}
      </div>
      <p className="mt-3 truncate text-xs text-muted-foreground">{detail}</p>
    </button>
  );
}

export function DashboardWorkspaceSelector({
  summaries,
  selectedValue,
  onSelect,
  totalSessionCount,
}: DashboardWorkspaceSelectorProps) {
  const radioRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const { visibleSummaries, overflowSummaries } = useMemo(() => {
    if (summaries.length <= DASHBOARD_VISIBLE_WORKSPACES) {
      return {
        visibleSummaries: summaries,
        overflowSummaries: [] as WorkspaceScopeSummary[],
      };
    }

    const pinnedValue =
      selectedValue === ALL_WORKSPACES_VALUE ? null : selectedValue;
    const pinnedSummary = pinnedValue
      ? summaries.find((summary) => summary.value === pinnedValue) ?? null
      : null;
    const remaining = summaries.filter((summary) => summary.value !== pinnedValue);
    const visible = pinnedSummary
      ? [pinnedSummary, ...remaining.slice(0, DASHBOARD_VISIBLE_WORKSPACES - 1)]
      : remaining.slice(0, DASHBOARD_VISIBLE_WORKSPACES);

    return {
      visibleSummaries: visible,
      overflowSummaries: summaries.filter(
        (summary) => !visible.some((visibleSummary) => visibleSummary.value === summary.value),
      ),
    };
  }, [selectedValue, summaries]);

  const radioValues = [
    ALL_WORKSPACES_VALUE,
    ...visibleSummaries.map((summary) => summary.value),
  ];

  return (
    <div className="mt-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Workspace scope
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Switch between aggregate metrics and workspace-specific activity.
          </p>
        </div>
        {overflowSummaries.length ? (
          <p className="text-xs text-muted-foreground">
            {overflowSummaries.length} more workspace
            {overflowSummaries.length === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_14rem]">
        <div
          aria-label="Workspace scope"
          className="contents"
          role="radiogroup"
        >
          <DashboardWorkspaceCard
            buttonRef={(element) => {
              radioRefs.current[ALL_WORKSPACES_VALUE] = element;
            }}
            description={`${summaries.length} workspace${summaries.length === 1 ? "" : "s"} · ${formatSessionCount(totalSessionCount)}`}
            detail="Combined scope across all tracked workspaces."
            onKeyDown={(event, value) => {
              moveFocusByArrowKey(event, radioValues, radioRefs, value);
            }}
            onSelect={onSelect}
            selected={selectedValue === ALL_WORKSPACES_VALUE}
            title="All workspaces"
            value={ALL_WORKSPACES_VALUE}
          />

          {visibleSummaries.map((summary) => (
            <DashboardWorkspaceCard
              buttonRef={(element) => {
                radioRefs.current[summary.value] = element;
              }}
              description={buildWorkspaceDescription(summary)}
              detail={summary.path}
              key={summary.value}
              onKeyDown={(event, value) => {
                moveFocusByArrowKey(event, radioValues, radioRefs, value);
              }}
              onSelect={onSelect}
              selected={selectedValue === summary.value}
              title={summary.label}
              value={summary.value}
            />
          ))}
        </div>

        {overflowSummaries.length ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-secondary/20 px-4 py-3">
            <label
              className="block text-xs uppercase tracking-[0.18em] text-muted-foreground"
              htmlFor="workspace-overflow-select"
            >
              More workspaces
            </label>
            <p className="mt-1 text-sm text-muted-foreground">
              Use the fallback picker when the selector set exceeds the hero space.
            </p>
            <select
              className="mt-3 h-11 w-full rounded-xl border border-border/70 bg-background/70 px-3 font-mono text-sm text-foreground outline-none transition focus:border-accent/40 focus:ring-2 focus:ring-ring"
              defaultValue=""
              id="workspace-overflow-select"
              onChange={(event) => {
                if (!event.target.value) {
                  return;
                }

                onSelect(event.target.value);
                event.target.value = "";
              }}
            >
              <option disabled value="">
                Browse hidden workspaces
              </option>
              {overflowSummaries.map((summary) => (
                <option key={summary.value} value={summary.value}>
                  {summary.label} ({formatSessionCount(summary.sessionCount)})
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
    </div>
  );
}

type PanelWorkspaceSelectorProps = {
  summaries: WorkspaceScopeSummary[];
  selectedValue: string;
  onSelect: (value: string) => void;
  totalSessionCount: number;
};

export function PanelWorkspaceSelector({
  summaries,
  selectedValue,
  onSelect,
  totalSessionCount,
}: PanelWorkspaceSelectorProps) {
  const [open, setOpen] = useState(false);
  const selectorId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const options = useMemo(() => {
    const allOption: WorkspaceScopeSummary = {
      value: ALL_WORKSPACES_VALUE,
      label: "All workspaces",
      path: "Aggregate scope",
      sessionCount: totalSessionCount,
      latestUpdatedAt: summaries[0]?.latestUpdatedAt ?? "",
      hasActiveSession: summaries.some((summary) => summary.hasActiveSession),
      isLatest: selectedValue === ALL_WORKSPACES_VALUE,
    };

    return [allOption, ...summaries];
  }, [selectedValue, summaries, totalSessionCount]);

  const selectedOption =
    options.find((option) => option.value === selectedValue) ?? options[0];

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    optionRefs.current[selectedOption.value]?.focus();
  }, [open, selectedOption.value]);

  const handleOptionKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentValue: string,
  ) => {
    const optionValues = options.map((option) => option.value);

    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      moveFocusByArrowKey(event, optionValues, optionRefs, currentValue);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(currentValue);
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={rootRef}>
      <Button
        aria-controls={selectorId}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="h-auto w-full items-start justify-between rounded-2xl border-border/80 bg-background/55 px-3 py-3 text-left font-normal hover:bg-background/65"
        onClick={() => {
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        type="button"
        variant="outline"
      >
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Workspace scope
          </p>
          <p className="mt-1 truncate font-mono text-sm font-semibold text-foreground">
            {selectedOption.label}
          </p>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {selectedOption.value === ALL_WORKSPACES_VALUE
              ? `${summaries.length} workspace${summaries.length === 1 ? "" : "s"} · ${formatSessionCount(totalSessionCount)}`
              : buildWorkspaceDescription(selectedOption)}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "mt-1 size-4 shrink-0 transition-transform",
            open ? "rotate-180" : "",
          )}
        />
      </Button>

      {open ? (
        <div className="absolute inset-x-0 top-full z-20 mt-1.5 overflow-hidden rounded-2xl border border-border/80 bg-popover/95 shadow-2xl shadow-black/20 backdrop-blur">
          <div
            aria-label="Workspace scope"
            className="max-h-64 overflow-y-auto p-1.5"
            id={selectorId}
            role="listbox"
          >
            {options.map((option) => {
              const selected = option.value === selectedValue;

              return (
                <button
                  key={option.value}
                  ref={(element) => {
                    optionRefs.current[option.value] = element;
                  }}
                  aria-selected={selected}
                  className={cn(
                    "flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    selected ? "bg-accent/12" : "hover:bg-secondary/45",
                  )}
                  onClick={() => {
                    onSelect(option.value);
                    setOpen(false);
                  }}
                  onKeyDown={(event) => {
                    handleOptionKeyDown(event, option.value);
                  }}
                  role="option"
                  type="button"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs font-semibold text-foreground">
                      {option.label}
                    </p>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {option.value === ALL_WORKSPACES_VALUE
                        ? `${summaries.length} workspace${summaries.length === 1 ? "" : "s"} · ${formatSessionCount(totalSessionCount)}`
                        : buildWorkspaceDescription(option)}
                    </p>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground/80">
                      {option.path}
                    </p>
                  </div>
                  {selected ? (
                    <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
