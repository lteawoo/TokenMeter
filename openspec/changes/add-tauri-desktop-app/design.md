## Context

TokenMeter currently runs as a browser dashboard backed by a local Node server. The React/Vite UI in `apps/dashboard` is already usable, and Codex session parsing exists in `packages/core`, but the desktop story is missing. If the project keeps the current architecture unchanged, any desktop packaging effort would either embed a separate Node process or duplicate UI logic in a second app surface.

The project is still early enough that a clean split between presentation and data access can be introduced before more providers, tray behavior, or packaging concerns are added. Rust and Cargo are now available locally, so Tauri can be introduced without blocking on environment setup.

## Goals / Non-Goals

**Goals:**
- Add a Tauri desktop shell that can host the existing TokenMeter dashboard UI.
- Allow the desktop build to load Codex session data without requiring `apps/server`.
- Preserve the current web dashboard workflow for browser-based development.
- Introduce a frontend data-source abstraction so the same UI can work in both web and desktop environments.

**Non-Goals:**
- Menubar or tray mode.
- Auto-launch, background startup, notifications, or packaging/signing polish.
- Claude Code, Gemini CLI, or other provider adapters.
- Full migration of all TypeScript parsing logic into Rust if a smaller interop layer is sufficient for the first desktop release.

## Decisions

### 1. Keep one React dashboard and add environment-specific data sources

The dashboard UI will remain in `apps/dashboard` and continue to own rendering, layout, and visualization. Data fetching will move behind a small interface so the UI can load:

- from HTTP in the web build
- from Tauri `invoke()` in the desktop build

Why:
- avoids forking the UI
- keeps web development fast
- creates the right seam for later provider adapters

Alternatives considered:
- Separate web and desktop frontends: rejected because it duplicates product UI work too early.
- Keep direct `fetch("/api/...")` in components: rejected because it hard-codes the web architecture and makes Tauri integration brittle.

### 2. Desktop builds will use Tauri commands instead of a bundled Node server

The desktop app will not depend on the existing Node server at runtime. Instead, Tauri commands will expose the desktop overview data needed by the dashboard.

Why:
- removes the need to supervise a second process inside the desktop app
- matches user expectations for a native utility app
- simplifies later packaging and startup behavior

Alternatives considered:
- Bundle and run `apps/server` inside the desktop app: faster to prototype, but poor long-term architecture and more operational complexity.

### 3. The first desktop scope will focus on Codex overview parity, not desktop-only features

The first implementation target is parity with the current Codex overview dashboard: current usage summary, recent sessions, and plan-limit indicators. Desktop-specific features such as tray mode and filesystem-driven live watching are deferred.

Why:
- keeps the first Tauri milestone narrow and testable
- proves the architecture before expanding native behavior

Alternatives considered:
- Start with tray-only mode: rejected because it increases native complexity before the desktop data path is stable.

### 4. Parsing logic will stay source-of-truth in one place, even if transport differs

Token normalization and overview shaping must remain consistent between web and desktop. If Rust does not immediately reimplement the TypeScript parser, the system still needs one clear contract for the overview payload returned to the frontend.

Why:
- prevents UI divergence between web and desktop
- allows later migration from TypeScript parsing to Rust parsing without changing frontend contracts

Alternatives considered:
- Independent web and desktop payload shapes: rejected because it creates unnecessary frontend branching.

## Risks / Trade-offs

- [Dual data paths drift over time] → Define a shared overview contract and verify both web and desktop implementations return the same shape.
- [Desktop integration increases setup and CI complexity] → Keep the first change focused on local development and defer packaging/signing concerns.
- [TypeScript parser may not map cleanly into Tauri-native code] → Allow a staged approach where the payload contract is stabilized first, then parsing internals can be improved later.
- [Desktop app may feel incomplete without tray/native affordances] → Explicitly keep those out of scope for the first desktop milestone and document them as follow-up work.

## Migration Plan

1. Add the Tauri project structure and confirm the existing dashboard renders inside a Tauri window.
2. Introduce a dashboard data-source abstraction and keep the current web API path working.
3. Add a desktop data path exposed via Tauri commands that returns the same overview contract as the web API.
4. Switch the desktop build to the Tauri data source and verify it works without `apps/server`.
5. Keep the current web workflow intact so rollback is simply “continue using the browser dashboard only.”

## Open Questions

- Should the first desktop implementation call into existing TypeScript parsing code or reimplement parsing in Rust immediately?
- Should the Tauri project live inside `apps/dashboard` or as a new sibling app such as `apps/desktop`?
- Do we want the first desktop milestone to include filesystem refresh triggers, or is manual/polled refresh sufficient?
