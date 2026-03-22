# Homebrew Tap Plan

## Recommendation

Create a dedicated tap repository:

- Repository: `lteawoo/homebrew-tokenmeter`
- Install command:

```bash
brew tap lteawoo/tokenmeter
brew install --cask tokenmeter
```

Update command:

```bash
brew update
brew upgrade --cask tokenmeter
```

This keeps the app source repository and the Homebrew packaging repository separate.
The current repository includes a ready-to-publish cask at [packaging/homebrew/Casks/tokenmeter.rb](/Users/twlee/projects/TokenMeter/packaging/homebrew/Casks/tokenmeter.rb).
The tap repository is now published at `lteawoo/homebrew-tokenmeter`.

## Why A Separate Tap Repo

- Homebrew tap updates stay isolated from product code changes
- Cask-only maintenance is simpler
- The repository naming matches Homebrew conventions for shorter tap commands
- GitHub Releases in `lteawoo/TokenMeter` can remain the source of signed DMG artifacts

## Recommended Repository Layout

```text
homebrew-tokenmeter/
  Casks/
    tokenmeter.rb
  README.md
```

## Current Cask

The current cask lives at [packaging/homebrew/Casks/tokenmeter.rb](/Users/twlee/projects/TokenMeter/packaging/homebrew/Casks/tokenmeter.rb).
It points at the published `v0.1.1` DMG asset and includes the current SHA256.

## Notes For The Cask

- The final DMG filename must match the actual Tauri release artifact
- `sha256` must be updated for every release
- If you ship multiple macOS architectures, decide whether to use:
  - one universal artifact
  - architecture-specific `on_arm` and `on_intel` blocks
- If TokenMeter needs extra uninstall or zap steps later, add them only after real user data paths are confirmed

## Release Flow

1. Publish a GitHub Release in `lteawoo/TokenMeter`.
2. Update `Casks/tokenmeter.rb` in `lteawoo/homebrew-tokenmeter`.
3. Commit and push the tap repository.
4. Validate with:

```bash
brew uninstall --cask tokenmeter || true
brew tap lteawoo/tokenmeter
brew install --cask tokenmeter
brew upgrade --cask tokenmeter
```

## Open Questions

- Will the release artifact be universal, arm64-only, or dual-arch
- Whether Homebrew should stay on a custom tap permanently or later target a broader cask submission
