# Agent Note: Minimum Windows version contract

Status: implemented

English | [中文](2026-11-24-windows-minimum-version.zh.md)

## Problem

Users on older Windows hardware could not tell from the download and install flow whether any Cherry Studio release supports Windows 7. One user launched the app through a third-party compatibility layer and hit unspecified problems, which looked like supported operation. There was no authoritative minimum-Windows-version contract in the installer guidance, startup path, update checks, or system-requirements documentation (issue #20218).

## Decision

The supported floor is Windows 10 1809 (build 17763, 64-bit x64/ARM64) or later, including Windows 11. Windows 7, 8, and 8.1 are unsupported, including launches through third-party compatibility layers. The contract is enforced in four places sharing one source of truth, `isSupportedWindowsRelease` in `src/shared/utils/osSupport.ts`:

- The NSIS installer runs a new `checkWindowsVersion` step in `customInit` that reads `CurrentMajorVersionNumber`/`CurrentBuildNumber` and aborts with a bilingual message before installing or changing any file.
- The main process runs a new synchronous preboot gate, `runOsSupportGate` in `src/main/core/preboot/osSupportGate.ts`, before `resolveUserDataLocation()`. On an unsupported release it shows a localized error dialog (`dialog.os_unsupported.*` in all 17 main locales), then quits with exit code 1 without touching user data.
- `AppUpdaterService` skips every update-check path (`performUpdateCheck`, `queryUpdateAvailability`, `getLatestReleaseNotes`) on an unsupported Windows release, reporting the install as current, and sends an `X-OS-Release` header so the feed can filter by OS build in the future.
- The installation docs and FAQ state the same minimum version in Chinese and English, explain that compatibility-layer launches are not official support, and mark archival GitHub Releases as reference-only with no support or security updates.

## Alternatives considered

- A higher floor (for example Windows 10 22H2): not chosen because Electron 23+ only requires Windows 10+, so 1809 maximizes supported coverage while keeping one build line.
- Blocking only at startup without an installer check: not chosen because the installer must not lay down files on a machine that can never run the build.
- Offering incompatible updates with a warning: not chosen because silently staying pinned as current is non-destructive and matches the startup refusal.

## Consequences

Windows 7/8/8.1 machines get a clear stop-and-explain message at install time, at startup, and (by absence of offers) at update time, without any user-data mutation. Supported machines are unaffected; update requests now carry the OS release for future server-side filtering. The external download page copy lives in the website repository and still needs a matching update there.

## Verification

- Regression — `pnpm vitest run --project shared src/shared/utils/__tests__/osSupport.test.ts`: 17 tests pass, covering the 17763 boundary, legacy NT 6.x rejection, and non-Windows passthrough.
- Regression — `pnpm vitest run --project main src/main/core/preboot/__tests__/osSupportGate.test.ts src/main/services/__tests__/AppUpdaterService.osSupport.test.ts src/main/services/__tests__/AppUpdaterService.test.ts src/main/services/__tests__/AppUpdaterService.scheduler.test.ts src/main/services/__tests__/AppUpdaterService.notAvailable.test.ts`: 68 tests pass, including Win7 blocking before user-data work and update-feed suppression.
- Regression — `pnpm exec tsx scripts/i18n-check.ts`: passes over 125122 translations, including the new `dialog.os_unsupported` keys in all 17 main locales.
- Regression — `pnpm run typecheck:node`, eslint, oxlint, and oxfmt on all touched source and test files: clean.
- Regression — `pnpm exec tsx scripts/docsGovernance/check-doc-links.ts`: all 912 markdown files link-clean, including the new English installation pages.
