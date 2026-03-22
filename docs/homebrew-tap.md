# Homebrew Tap Plan

## Recommendation

Create a dedicated tap repository:

- Repository: `lteawoo/homebrew-tokenmeter`
- Install command:

```bash
brew tap lteawoo/tokenmeter
brew install --cask tokenmeter
```

This keeps the app source repository and the Homebrew packaging repository separate.
The current repository includes a seed cask at [packaging/homebrew/Casks/tokenmeter.rb](/Users/twlee/projects/TokenMeter/packaging/homebrew/Casks/tokenmeter.rb) that can be copied into the tap repository when it is created.

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

## Initial Cask Draft

The current draft lives at [packaging/homebrew/Casks/tokenmeter.rb](/Users/twlee/projects/TokenMeter/packaging/homebrew/Casks/tokenmeter.rb).

## Notes For The Cask

- The final DMG filename must match the actual Tauri release artifact
- `sha256` must be updated for every release
- If you ship multiple macOS architectures, decide whether to use:
  - one universal artifact
  - architecture-specific `on_arm` and `on_intel` blocks
- If TokenMeter needs extra uninstall or zap steps later, add them only after real user data paths are confirmed

## Release Flow

1. Publish a signed DMG to `lteawoo/TokenMeter` GitHub Releases.
2. Compute the artifact SHA256.
3. Update `Casks/tokenmeter.rb` in `lteawoo/homebrew-tokenmeter`.
4. Commit and push the cask update.
5. Validate with:

```bash
brew uninstall --cask tokenmeter || true
brew tap lteawoo/tokenmeter
brew install --cask tokenmeter
```

## Open Questions

- Will the release artifact be universal, arm64-only, or dual-arch
- What the final bundle identifier will be
- Whether Homebrew should stay on a custom tap permanently or later target a broader cask submission
