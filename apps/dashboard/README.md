# TokenMeter Dashboard

The dashboard app serves two runtime targets:

- Web development via Vite + the local Node API in `apps/server`
- Native desktop development via Tauri, without requiring the Node API at runtime

## Prerequisites

- `pnpm`
- `Node.js 20+`
- Rust toolchain (`rustup`, `cargo`, `rustc`)
- Xcode Command Line Tools on macOS

## Development Workflows

### Web dashboard

Run the browser workflow from the workspace root:

```bash
pnpm dev
```

This starts:

- Vite on `http://localhost:5173`
- The local API on `http://localhost:3001`

The browser app loads Codex overview data from:

```text
/api/providers/codex/overview
```

### Desktop dashboard

Run the native desktop shell from the workspace root:

```bash
pnpm dev:desktop
```

This starts the Vite frontend for Tauri and launches a native window. In desktop mode, the dashboard reads Codex overview data through a Tauri command instead of the Node API, so `apps/server` does not need to be running.
The Tauri dev/build workflow injects `VITE_TOKENMETER_RUNTIME=desktop` so the shared frontend selects the desktop data path from the first render.

The desktop app also creates a menu bar icon:

- Left click opens the compact summary window
- `Open Dashboard` restores and focuses the window
- `Refresh` asks the frontend to reload overview data
- `Quit TokenMeter` exits the app

Build the desktop app with:

```bash
pnpm build:desktop
```

## Architecture Notes

- Shared UI lives in `apps/dashboard`
- Web data path uses `fetch("/api/providers/codex/overview")`
- Desktop data path uses `invoke("get_codex_overview")`
- The frontend switches at runtime through `src/lib/codex-overview.ts`
- Desktop-side overview shaping lives in `src-tauri/src/codex.rs`

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
