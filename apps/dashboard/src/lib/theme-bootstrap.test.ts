import { describe, expect, it, vi } from "vitest";

import { bootstrapDocumentTheme } from "./theme-bootstrap";

describe("bootstrapDocumentTheme", () => {
  it("applies persisted desktop theme before render when settings load succeeds", async () => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.colorScheme = "dark";

    const resolvedTheme = await bootstrapDocumentTheme({
      getRuntimeKind: () => "desktop",
      loadDesktopSettings: async () => ({
        codexRootPath: "/Users/twlee/.codex/sessions",
        themeMode: "light",
        trayMetricMode: "weekly",
        trayPresentationMode: "text-only",
      }),
    });

    expect(resolvedTheme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("falls back to the default theme when desktop settings cannot be loaded", async () => {
    document.documentElement.dataset.theme = "light";
    document.documentElement.style.colorScheme = "light";

    const resolvedTheme = await bootstrapDocumentTheme({
      getRuntimeKind: () => "desktop",
      loadDesktopSettings: vi.fn().mockRejectedValue(new Error("bridge unavailable")),
    });

    expect(resolvedTheme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});
