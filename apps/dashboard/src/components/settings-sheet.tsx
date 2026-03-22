import { useEffect } from "react";

import type { AppSettings, ThemeMode, TrayMetricMode } from "@/lib/app-settings";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type SettingsSheetProps = {
  open: boolean;
  runtimeKind: "web" | "desktop";
  saving: boolean;
  error: string | null;
  compact?: boolean;
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onClose: () => void;
  onSave: (settings: AppSettings) => Promise<void>;
};

const THEME_OPTIONS: Array<{ label: string; value: ThemeMode }> = [
  { label: "System", value: "system" },
  { label: "Dark", value: "dark" },
  { label: "Light", value: "light" },
];

const TRAY_METRIC_OPTIONS: Array<{ label: string; value: TrayMetricMode }> = [
  { label: "5H", value: "five-hour" },
  { label: "Weekly", value: "weekly" },
  { label: "Both", value: "both" },
];

function OptionGroup<T extends string>({
  legend,
  options,
  onChange,
  value,
}: {
  legend: string;
  options: Array<{ label: string; value: T }>;
  onChange: (value: T) => void;
  value: T;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
        {legend}
      </legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((option) => (
          <label
            className="flex cursor-pointer items-center gap-2 rounded-xl border border-border/70 bg-secondary/35 px-3 py-2 text-sm text-foreground"
            key={option.value}
          >
            <input
              checked={value === option.value}
              className="accent-[var(--accent)]"
              name={legend}
              onChange={() => onChange(option.value)}
              type="radio"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SettingsSheet({
  open,
  runtimeKind,
  saving,
  error,
  compact = false,
  settings,
  onChange,
  onClose,
  onSave,
}: SettingsSheetProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className={
        compact
          ? "fixed inset-0 z-50 bg-black/35 p-1.5 backdrop-blur-sm"
          : "fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm"
      }
    >
      <Card
        aria-labelledby="settings-title"
        aria-modal="true"
        className={
          compact
            ? "flex h-full w-full flex-col overflow-hidden rounded-[22px] border-border/80 bg-card/95 shadow-2xl"
            : "w-full max-w-2xl border-border/80 bg-card/95 shadow-2xl"
        }
        role="dialog"
      >
        <CardHeader className={compact ? "gap-2 pb-3" : "gap-2"}>
          <CardTitle className={compact ? "font-mono text-xl" : "font-mono text-2xl"} id="settings-title">
            Settings
          </CardTitle>
          <CardDescription>
            Configure the Codex source path, app theme, and menu bar display.
          </CardDescription>
        </CardHeader>
        <CardContent
          className={
            compact ? "flex min-h-0 flex-1 flex-col gap-4 overflow-hidden" : "grid gap-6"
          }
        >
          <div className={compact ? "grid gap-4 overflow-y-auto pr-1" : "grid gap-6"}>
            <div className="grid gap-2">
              <label
                className="text-xs uppercase tracking-[0.18em] text-muted-foreground"
                htmlFor="codex-root-path"
              >
                Codex root
              </label>
              <input
                className="h-11 rounded-xl border border-border/70 bg-background px-3 text-sm text-foreground outline-none transition focus:border-ring"
                disabled={runtimeKind !== "desktop"}
                id="codex-root-path"
                onChange={(event) =>
                  onChange({
                    ...settings,
                    codexRootPath: event.target.value,
                  })
                }
                placeholder="~/.codex/sessions"
                value={settings.codexRootPath}
              />
              <p className="text-xs text-muted-foreground">
                {runtimeKind === "desktop"
                  ? "Desktop mode validates and persists this path before using it."
                  : "Browser preview does not persist this path. Use TOKENMETER_CODEX_ROOT in the local server environment instead."}
              </p>
            </div>

          <OptionGroup
            legend="Theme"
            onChange={(themeMode) =>
              onChange({
                ...settings,
                themeMode,
              })
            }
            options={THEME_OPTIONS}
            value={settings.themeMode}
          />

          <OptionGroup
            legend="Tray metric"
            onChange={(trayMetricMode) =>
              onChange({
                ...settings,
                trayMetricMode,
              })
            }
            options={TRAY_METRIC_OPTIONS}
            value={settings.trayMetricMode}
          />

            {error ? (
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border/70 pt-3">
            <Button onClick={onClose} type="button" variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={saving}
              onClick={() => {
                void onSave(settings);
              }}
              type="button"
            >
              {saving ? "Saving..." : "Save settings"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
