# Agent Note: Raise skill install size ceiling to 130 MiB and isolate collection member failures

Status: implemented

English | [中文](2026-11-21-skill-install-size-limit-and-collection-isolation.zh.md)

## Problem

Live verification against all 128 CherryIN marketplace packages on `main` (`ccc2d00c63`) revealed two install failures reported under issue #24986:

1. Two published packages slightly exceeded the 100 MiB (`104,857,600`-byte) `MAX_SKILL_SIZE` ceiling: single skill `Gorden PPT Skill` (`106,791,792` bytes) and collection member `trialgpt-matching/` inside `Openclaw Medical Skills` (`109,892,535` bytes).
2. `downloadSkillPackage` validated every discovered candidate in a loop and aborted the entire download on the first failing member, discarding all remaining valid members in a multi-skill collection (895 of 896 skills in `Openclaw Medical Skills`) even though `SkillService.installMarketplacePackage`, `SkillService.installSubscription`, and `MarketplaceSkillDialog` already support per-member partial failure reporting.

## Decision

- Raise `MAX_SKILL_SIZE` in `src/main/ai/skills/skillArchive.ts` from 100 MiB to 130 MiB (`136,314,880` bytes) across install paths, and include human-readable MiB totals alongside exact byte counts in `assertSkillDirectoryWithinLimits` errors.
- Split out `MAX_SKILL_EXPORT_SIZE` at 100 MiB (`104,857,600` bytes) for `exportSkillArchive`, because export buffers every file in memory and returns a `Uint8Array` over IPC.
- In `downloadSkillPackage`, isolate per-member validation failures (`validateRepositorySkillDirectory`, `assertSkillDirectoryWithinLimits`, `parseSkillMetadata`, and folder-name conflicts) when `candidates.length > 1`. Record failed members in `{ members, failed }` and continue staging valid members so `SkillService.installMarketplacePackage` and `SkillService.installSubscription` install all valid members and surface per-member failures. Keep whole-package rejection for archive-level hazards (exceeding `MAX_ARCHIVE_SIZE`, symlinks, path traversal, case-folded collisions, empty packages) and single-skill packages (`candidates.length === 1`).
- Cache `downloaded.members` (including validation-failed members) in `downloadMarketplaceSkill` and `SkillSubscriptionService.detail` so collection totals stay aligned with partial install results.

## Alternatives considered

- Keeping `MAX_SKILL_SIZE` at 100 MiB leaves existing published packages above 100 MiB uninstallable until upstream catalog cleanup lands.
- Raising the export ceiling together with the install ceiling would increase main-process memory spikes and IPC payload sizes during `skill.export` until export streams directly to disk.
- Isolating failures for single-skill packages (`candidates.length === 1`) would replace the direct install error toast with a generic `Installed 0/1` partial-install toast and break the single-member rejection contract.

## Consequences

- Installed skills between 100 MiB and 130 MiB now succeed across CherryIN, ZIP, GitHub, skills.sh, claude-plugins, clawhub, and ZIP subscription installs, while attempting to export a skill over 100 MiB still throws `Skill exceeds the export size limit`.
- Multi-skill collections from CherryIN or ZIP subscriptions no longer fail as a whole when one member exceeds the per-skill size limit or fails member validation; valid members are installed and failed members appear with names and reasons in `MarketplaceInstallResult.failed`.
- Archive-level ceilings (`MAX_ARCHIVE_SIZE` 1 GiB, `MAX_ARCHIVE_ENTRIES` 50,000) and security checks remain unchanged.

## Verification

- Regression — `accepts a skill directory between the previous 100 MiB and current 130 MiB install ceiling`: confirms a 110 MiB skill passes `assertSkillDirectoryWithinLimits`.
- Regression — `refuses a skill directory over the per-skill size limit, reporting its real size`: confirms a 140 MiB directory reports both exact bytes and `(140 MiB)` against the `(130 MiB)` limit.
- Regression — `rejects directory junctions and oversize files without exporting outside contents`: confirms a skill over `MAX_SKILL_EXPORT_SIZE` (100 MiB) still passes install limits while `exportSkillArchive` rejects it.
- Regression — `installs valid collection members when another member exceeds the per-skill size limit`, `returns per-member failures when every member in a multi-skill collection exceeds the size limit`, and `isolates oversized members when installing a ZIP subscription collection`: confirm multi-skill CherryIN and ZIP subscription collections isolate member validation failures and clean up temp directories.
- Regression — `pnpm test:main src/main/ipc/handlers/__tests__/skill.test.ts` and `pnpm test:renderer src/renderer/pages/marketplace/__tests__/useMarketplace.test.tsx`: 31 main handler tests and 4 renderer hook tests pass.
- Regression — `pnpm test:main src/main/ai/skills/__tests__/SkillService.test.ts`: 183 of 189 tests pass on Windows, including all 12 CherryIN marketplace tests and all size/export tests; 6 unrelated pre-existing tests fail with Windows `EPERM` on `fs.promises.symlink`.
- Regression — `pnpm exec oxfmt --check`, `pnpm exec oxlint --deny-warnings`, `pnpm exec eslint` on the 5 changed TS files and `pnpm typecheck:node`: all pass with 0 warnings and 0 errors.
