---
name: tokenmeter-release
description: TokenMeter의 패치/마이너 릴리즈를 준비하고 이슈, 브랜치, 커밋, PR, 머지, 태그, GitHub Release, Homebrew tap cask 업데이트, 설치 검증까지 수행할 때 사용한다. 사용자가 릴리즈, 배포, brew cask 버전업, PR/이슈/머지/브랜치 정리를 함께 요청하면 적용한다.
---

# TokenMeter Release

TokenMeter의 macOS desktop release와 `lteawoo/homebrew-tokenmeter` cask 배포를 end-to-end로 처리한다.

## 원칙

- `master`에 직접 커밋하지 않는다. 항상 목적이 분명한 작업 브랜치를 만든다.
- 태그는 PR merge 후 `origin/master`와 동기화된 merge commit에만 찍는다.
- cask `sha256`은 반드시 실제 DMG `shasum` 또는 GitHub Release asset digest와 일치시킨다.
- source repo의 `packaging/homebrew/Casks/tokenmeter.rb`와 tap repo의 `Casks/tokenmeter.rb`를 모두 같은 버전/SHA로 맞춘다.
- `brew audit`는 source repo 경로가 아니라 tap 기준으로 실행한다.
- PR merge 메시지를 커스텀해서 issue auto-close가 누락되면 이슈를 수동으로 `completed` 처리한다.
- destructive git 명령은 쓰지 않는다.

## 사전 확인

먼저 현재 상태와 원격 상태를 확인한다.

```bash
git status --short --branch
git remote -v
git branch --show-current
git tag --sort=-version:refname
gh auth status
gh repo view --json nameWithOwner,defaultBranchRef,url
gh issue list --state open --limit 50
gh pr list --state open --limit 50
gh repo view lteawoo/homebrew-tokenmeter --json nameWithOwner,defaultBranchRef,url
```

현재 최신 GitHub Release와 cask 기준도 확인한다.

```bash
gh release view "v<current-version>" --repo lteawoo/TokenMeter --json tagName,isDraft,isPrerelease,publishedAt,assets,url
sed -n '1,80p' packaging/homebrew/Casks/tokenmeter.rb
```

## 변경 준비

1. 작업 브랜치를 만든다.

```bash
git switch -c fix/<short-name>
```

2. 필요하면 추적 이슈를 만든다.

```bash
gh issue create --repo lteawoo/TokenMeter --title "<title>" --body "<body>"
```

3. 릴리즈 버전을 결정한다.

- 버그 수정: patch version
- 사용자 기능 추가: minor version
- 이미 배포된 tag/release는 수정하지 말고 새 버전으로 간다.

4. 버전을 동기화한다.

- `package.json`
- `apps/dashboard/src-tauri/tauri.conf.json`
- `apps/dashboard/src-tauri/Cargo.toml`
- `apps/dashboard/src-tauri/Cargo.lock`
- `README.md`
- `packaging/homebrew/Casks/tokenmeter.rb`

cask SHA는 DMG 빌드 후 채운다. 임시 placeholder를 넣었다면 커밋 전 반드시 제거한다.

## 필수 검증

릴리즈 후보에서 다음을 실행한다.

```bash
pnpm --filter @tokenmeter/dashboard build
cargo test --manifest-path apps/dashboard/src-tauri/Cargo.toml
pnpm --filter @tokenmeter/dashboard tauri:build
```

DMG SHA와 번들 메타데이터를 확인한다.

```bash
shasum -a 256 apps/dashboard/src-tauri/target/release/bundle/dmg/TokenMeter_<version>_aarch64.dmg
defaults read "$PWD/apps/dashboard/src-tauri/target/release/bundle/macos/TokenMeter.app/Contents/Info" CFBundleShortVersionString
defaults read "$PWD/apps/dashboard/src-tauri/target/release/bundle/macos/TokenMeter.app/Contents/Info" LSUIElement
```

macOS tray/menu bar 변경이면 설치 전 산출물 실행도 확인한다.

```bash
open "$PWD/apps/dashboard/src-tauri/target/release/bundle/macos/TokenMeter.app"
osascript -e 'tell application "System Events"' -e 'if exists process "TokenMeter" then' -e 'tell process "TokenMeter" to return {visible, count of windows, name of windows}' -e 'else' -e 'return "not running"' -e 'end if' -e 'end tell'
```

## PR 및 머지

1. 커밋 전 확인:

```bash
git diff --check
git diff --stat
git status --short
```

2. 커밋한다. 버그 수정 릴리즈 예:

```bash
git add <changed-files>
git commit -m "fix: <한글 요약>"
```

3. push 후 PR을 만든다.

```bash
git push -u origin <branch>
gh pr create --repo lteawoo/TokenMeter --base master --head <branch> --title "<title>" --body "<body>"
```

PR body에는 반드시 포함한다.

- 관련 이슈: `Closes #<number>`
- 변경 요약
- 검증 명령과 결과
- DMG SHA256
- 리스크와 롤백

4. 라벨을 붙인다.

```bash
gh pr edit <number> --repo lteawoo/TokenMeter --add-label bug
```

5. mergeable 상태를 확인하고 머지한다.

```bash
gh pr view <number> --repo lteawoo/TokenMeter --json state,mergeable,statusCheckRollup,labels
gh pr merge <number> --repo lteawoo/TokenMeter --merge --delete-branch
```

6. 로컬을 정리한다.

```bash
git switch master
git pull --ff-only origin master
git branch --delete <branch>
git remote prune origin
```

이슈가 자동으로 닫히지 않았으면 수동 처리한다.

```bash
gh issue close <number> --repo lteawoo/TokenMeter --reason completed --comment "Fixed by #<pr> and released in v<version>."
```

## GitHub Release

PR merge 후 최신 `master`에서 태그와 릴리즈를 만든다.

```bash
git tag -a v<version> -m "TokenMeter v<version>"
git push origin v<version>
gh release create v<version> apps/dashboard/src-tauri/target/release/bundle/dmg/TokenMeter_<version>_aarch64.dmg --repo lteawoo/TokenMeter --title "TokenMeter v<version>" --notes "<release-notes>"
```

asset digest를 확인한다.

```bash
gh release view v<version> --repo lteawoo/TokenMeter --json tagName,assets,url
```

## Homebrew Tap

tap repo가 없으면 clone한다.

```bash
git clone https://github.com/lteawoo/homebrew-tokenmeter.git /Users/twlee/projects/homebrew-tokenmeter
```

tap repo의 `Casks/tokenmeter.rb`를 source cask와 같은 버전/SHA로 갱신한다.

```bash
git -C /Users/twlee/projects/homebrew-tokenmeter status --short --branch
git -C /Users/twlee/projects/homebrew-tokenmeter diff --check
git -C /Users/twlee/projects/homebrew-tokenmeter add Casks/tokenmeter.rb
git -C /Users/twlee/projects/homebrew-tokenmeter commit -m "chore: tokenmeter <version> cask 업데이트"
git -C /Users/twlee/projects/homebrew-tokenmeter push origin main
```

Homebrew local tap을 갱신하고 검증한다.

```bash
brew update
brew info --cask tokenmeter
brew audit --cask tokenmeter --tap lteawoo/tokenmeter
brew fetch --cask --force --retry tokenmeter
```

이미 설치된 환경까지 검증해야 하면 업그레이드한다.

```bash
brew upgrade --cask tokenmeter
```

## 최종 설치 검증

설치된 앱 메타데이터와 실행 상태를 확인한다.

```bash
defaults read /Applications/TokenMeter.app/Contents/Info CFBundleShortVersionString
defaults read /Applications/TokenMeter.app/Contents/Info LSUIElement
brew info --cask tokenmeter
```

tray/menu bar 앱이면 실행 후 Dock/window 상태와 menu bar item을 확인한다.

```bash
osascript -e 'tell application "TokenMeter" to quit'
open -a TokenMeter
osascript -e 'tell application "System Events"' -e 'if exists process "TokenMeter" then' -e 'tell process "TokenMeter" to return {visible, count of windows, name of windows}' -e 'else' -e 'return "not running"' -e 'end if' -e 'end tell'
osascript -e 'tell application "System Events"' -e 'tell process "TokenMeter"' -e 'repeat with b in menu bars' -e 'try' -e 'log (name of menu bar items of b as text)' -e 'end try' -e 'end repeat' -e 'end tell' -e 'end tell'
```

마지막으로 두 저장소가 clean인지 확인한다.

```bash
git status --short --branch
git -C /Users/twlee/projects/homebrew-tokenmeter status --short --branch
```
