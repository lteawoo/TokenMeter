# TokenMeter Release Strategy

## Release Summary

- Product: local-service-backed Tauri desktop app
- Primary target: macOS desktop distribution
- Primary install channel: Homebrew Cask via custom tap
- Secondary install channel: direct download from GitHub Releases
- Artifact hosting: GitHub Releases
- External hosting: none
- Rollback model: reinstall the previous desktop build
- Recommended tap repository: `lteawoo/homebrew-tokenmeter`

## Deployment Model

TokenMeter is not operated as a public web service.
The browser runtime exists for local development and debugging.
Users are expected to launch a desktop application that keeps all UI, runtime logic, and local data access on the same machine.

This has two practical consequences:

- release quality is defined by desktop install and runtime behavior, not by server uptime
- operational risk is concentrated in packaging, signing, local process startup, and upgrade safety

## Release Stages

### Stage 1: Release Artifact Foundation

- Target platform: macOS only
- Audience: maintainers and a small internal test group
- Goal: publish a signed DMG and validate install flow, tray behavior, dashboard rendering, and local data loading
- Artifact: DMG shared through GitHub Releases or a private release link

### Stage 2: Homebrew Tap Distribution

- Target platform: macOS only
- Audience: broader trusted testers
- Goal: make `brew tap ... && brew install --cask tokenmeter` the preferred install flow
- Artifact: Homebrew Cask in `lteawoo/homebrew-tokenmeter`, backed by signed release artifacts

### Stage 3: Broader Stable Release

- Target platform: macOS first, Windows later
- Audience: general users
- Goal: repeatable release process with stable metadata, signing, Homebrew install, and rollback instructions
- Artifact: GitHub release with signed installers and release notes

## Pre-Release Requirements

### App Metadata

- Replace the placeholder Tauri identifier with a real reverse-domain identifier
- Update Cargo package metadata:
  - package name
  - description
  - authors
  - license
  - repository
- Align version numbers across:
  - root `package.json`
  - Tauri configuration
  - Cargo manifest
  - Git tag and GitHub Release

### Signing and Platform Readiness

- Prepare Apple Developer signing credentials
- Configure notarization for macOS release builds
- Validate app icon assets and bundle metadata
- Decide when Windows signing becomes necessary

### Runtime Safety

- Confirm the desktop app works without an externally hosted backend
- Verify any local helper service starts only when required
- Check for local port conflicts if a companion process is introduced
- Confirm app shutdown cleans up child processes cleanly

## Release Workflow

### Before Build

- Confirm `pnpm build` passes
- Confirm `pnpm build:desktop` passes on the target release machine
- Review release notes and version number
- Verify signing credentials are available in CI or on the release machine

### Build and Package

- Build the desktop bundle from a clean git state
- Produce versioned DMG artifacts
- Upload artifacts to a GitHub prerelease or release
- Keep the exact commit SHA tied to each published artifact
- Publish or update the Homebrew Cask definition to point at the release artifact

### Verification

Run these checks on a clean machine when possible:

- app installs successfully
- app launches without terminal setup
- tray icon appears and responds
- dashboard opens from the tray
- refresh action reloads overview data
- workspace selection works in both dashboard and compact panel
- app can be quit and relaunched cleanly
- Homebrew tap install resolves to the expected signed build once the cask path exists

## Rollback Strategy

- Remove the latest release from the release channel if it is broken
- Re-publish or point users to the previous known-good installer
- Keep release notes explicit about downgrade steps
- Avoid destructive local data migrations until upgrade and rollback paths are tested

## Risks

### High Risk

- Placeholder app identifier and metadata cause poor release quality or signing problems
- Signing and notarization are not prepared before attempting public macOS distribution

### Medium Risk

- Development-only runtime assumptions leak into packaged desktop builds
- Release steps remain manual and produce inconsistent artifacts

### Low Risk

- Browser preview mode is misunderstood as a public deployment target

## Recommended Next Steps

1. Finalize desktop app metadata in Tauri and Cargo manifests.
2. Add a GitHub Actions workflow for tagged desktop builds.
3. Publish a macOS DMG through GitHub Releases and validate installation on a clean machine.
4. Add a Homebrew Cask path that installs from the signed release artifact.
5. Add a release checklist to each tagged release until automation is stable.

See [docs/homebrew-tap.md](/Users/twlee/projects/TokenMeter/docs/homebrew-tap.md) for the recommended tap repository layout and an initial cask draft.
