# TokenMeter Dashboard

The dashboard package serves two local runtime targets:

- Browser preview for development through Vite and the local API in `apps/server`
- Native desktop runtime through Tauri for the shipped application

The browser path is a local development surface. TokenMeter is not intended to be deployed as a hosted web service.

## Prerequisites

- `pnpm`
- `Node.js 20+`
- Rust toolchain (`rustup`, `cargo`, `rustc`)
- Xcode Command Line Tools on macOS

## Development Workflows

### Browser preview

Run the browser workflow from the workspace root:

```bash
pnpm dev
```

This starts:

- Vite on `http://localhost:5173`
- The local API on `http://localhost:3001`

The browser preview loads Codex overview data from:

```text
/api/providers/codex/overview
```

To point the browser preview at a different local Codex sessions root, start the server with:

```bash
TOKENMETER_CODEX_ROOT=/absolute/path/to/.codex/sessions pnpm dev
```

This matches the desktop app's Codex root contract, but the browser preview does not persist settings between runs.

### Desktop app

Run the native desktop shell from the workspace root:

```bash
pnpm dev:desktop
```

This starts the Vite frontend for Tauri and launches a native window. In desktop mode, the dashboard reads Codex overview data through a Tauri command instead of the Node API, so `apps/server` is only there to support the local development loop.
The Tauri dev/build workflow injects `VITE_TOKENMETER_RUNTIME=desktop` so the shared frontend selects the desktop data path from the first render.
The Tauri dev workflow prefers `http://localhost:5173`, then automatically selects another free local port when `5173` is already busy. To force a specific port:

```bash
TOKENMETER_DASHBOARD_DEV_PORT=5174 pnpm dev:desktop
```

The desktop app also creates a menu bar icon:

- Left click opens the compact summary window
- `Open Dashboard` restores and focuses the window
- `Refresh` asks the frontend to reload overview data
- `Quit TokenMeter` exits the app

Desktop settings are available from both the dashboard and the compact panel. They control:

- Codex root path for desktop overview loading
- Theme mode (`system`, `dark`, or `light`)
- Menu bar metric mode (`5H`, `Weekly`, or `Both`)
- Menu bar presentation (`Icon + text` or `Text only`)

Build the desktop app with:

```bash
pnpm build:desktop
```

## Runtime Architecture

- Shared UI lives in `apps/dashboard`
- Browser preview data uses `fetch("/api/providers/codex/overview")`
- Desktop runtime data uses `invoke("get_codex_overview")`
- The frontend switches at runtime through `src/lib/codex-overview.ts`
- Desktop-side overview shaping lives in `src-tauri/src/codex.rs`

## Release Position

TokenMeter should be treated as a local-first Tauri desktop app.
The browser runtime is useful for development and debugging, but the release artifact is the desktop bundle produced by `pnpm build:desktop`.

## Current Scope

The first desktop milestone covers:

- Native Tauri window shell
- Codex overview cards, charts, and session ledger
- Web and desktop data-source parity for the current dashboard contract

Deferred follow-up work:

- Auto-launch and background startup
- Live filesystem watching instead of refresh-driven loading
- Additional providers such as Claude Code or Gemini CLI
- Packaging, signing, and release polish
