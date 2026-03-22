# TokenMeter

TokenMeter is a local-first desktop app for understanding Codex usage on your machine.
It turns local session data into a compact menu bar view and a richer dashboard, so you can see where your sessions are going without sending that data to an external hosted service.

## Why TokenMeter

- See recent Codex activity at a glance from the menu bar
- Open a dashboard with overview cards, charts, and a session ledger
- Filter by workspace to understand where usage is concentrated
- Keep the workflow local-first, with data access and UI running on your machine

## What It Feels Like

TokenMeter is designed as a lightweight developer utility rather than a heavy analytics product.
The compact surface is meant for quick checks. The dashboard is there when you want more context, trends, and session-level detail.

## Requirements

- macOS
- Local Codex usage data on the same machine

## Installation

TokenMeter should be installed as a desktop app.
The preferred install path is Homebrew.

### Homebrew Tap

Once the tap is published, install TokenMeter like this:

```bash
brew tap lteawoo/tokenmeter
brew install --cask tokenmeter
```

### OR GitHub Releases Download

Download the latest signed DMG from GitHub Releases and install TokenMeter directly.

### Build From Source

If you want to run or package the app from this repository, you need:

- `pnpm`
- `Node.js 20+`
- Rust toolchain with `cargo`
- Xcode Command Line Tools on macOS

```bash
pnpm install
pnpm build:desktop
```

This produces the Tauri desktop bundle for TokenMeter.

### Run From Source In Development

```bash
pnpm dev:desktop
```

This starts the local desktop runtime for development.

## Notes

- TokenMeter is a desktop application, not an externally hosted web app
- The browser-based UI path exists to support local development and debugging
- The recommended Homebrew tap repository name is `lteawoo/homebrew-tokenmeter`
- Release planning and distribution details live in [docs/release-strategy.md](/Users/twlee/projects/TokenMeter/docs/release-strategy.md)
