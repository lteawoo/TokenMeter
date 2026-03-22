## 1. Tauri Shell Setup

- [x] 1.1 Add the Tauri project structure and desktop build dependencies to the workspace
- [x] 1.2 Configure the desktop app to load the existing `apps/dashboard` frontend in development and production
- [x] 1.3 Verify the dashboard UI renders in a native Tauri window

## 2. Dashboard Data Source Abstraction

- [x] 2.1 Refactor dashboard data loading behind a shared frontend data-source interface
- [x] 2.2 Keep the current web implementation using the existing HTTP API path
- [x] 2.3 Add environment detection or configuration so the dashboard can select the correct web or desktop data source at runtime

## 3. Desktop Native Data Path

- [x] 3.1 Add Tauri commands that expose Codex overview data needed by the dashboard
- [x] 3.2 Implement desktop-side overview shaping so it matches the frontend contract used by the current cards, charts, and session ledger
- [x] 3.3 Handle missing or unreadable Codex session data without crashing the desktop app

## 4. Integration and Verification

- [x] 4.1 Confirm the desktop app can load Codex overview data while `apps/server` is not running
- [x] 4.2 Verify the browser workflow still loads data from the existing web API
- [x] 4.3 Document the desktop development workflow and any deferred follow-up work such as tray mode or provider expansion
