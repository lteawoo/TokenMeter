## Why

TokenMeter already has a working React dashboard and a local Node API for web use, but it does not yet run as a self-contained desktop application. Adding a Tauri desktop shell now lets the project move from a browser-only prototype into a native macOS app while the current UI and Codex usage flows are still small enough to reshape cleanly.

## What Changes

- Add a Tauri-powered desktop application that loads the existing TokenMeter dashboard UI in a native shell.
- Introduce a desktop-native data source so the desktop app can read local Codex session data without depending on the Node web server.
- Separate dashboard data access behind a frontend abstraction so the same UI can work with both the web API and the Tauri backend.
- Keep the existing web dashboard workflow available for browser-based development.
- Exclude tray/menubar mode, auto-launch, and multi-provider support from this change.

## Capabilities

### New Capabilities
- `desktop-app`: Run TokenMeter as a native desktop app that presents the existing dashboard UI and reads local Codex usage data without a separate Node server.

### Modified Capabilities
- None.

## Impact

- Affected code: `apps/dashboard`, `apps/server`, `packages/core`, and a new Tauri app/runtime area.
- Affected architecture: dashboard data loading will move from a web-only fetch model to a pluggable web/desktop source model.
- New dependencies: Tauri CLI/runtime, Rust crates, and desktop build configuration.
- Affected platforms: local macOS development first, with room for later cross-platform expansion.
