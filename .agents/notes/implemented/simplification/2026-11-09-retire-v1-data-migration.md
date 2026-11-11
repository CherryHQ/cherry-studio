# Agent Note: Retire v1 data migration

Status: implemented

English | [中文](2026-11-09-retire-v1-data-migration.zh.md)

## Problem

Shipping the complete v1-to-v2 converter indefinitely retains an obsolete conversion engine, UI, and transport. Simply deleting the preboot gate can make an unmigrated profile look like a fresh installation and hide existing data.

## Decision

The application retains read-only legacy profile detection and directs unmigrated users through Cherry Studio **2.1.0**. This fixed release contains the converter and the required platform assets. The native preboot dialog offers a direct installer download or quit, before lifecycle bootstrap. The download action opens the fixed asset URL in the system browser and exits; dismissing the dialog also exits. Users install and launch the intermediate release, complete its migration, then reinstall the current version while preserving their data.

Installer selection uses operating system and architecture: macOS DMG, Windows setup or portable EXE matching the current installation, and Linux AppImage. Both x64 and arm64 are supported. Electron's ARM translation detection selects arm64 when an ARM computer runs an x64 application under Rosetta or WOW. No release page or moving latest-version link is involved.

Completed conversion status takes precedence over residual v1 files. A markerless database is recognized as established v2 only when it contains runtime seeding journal entries: the retired conversion engine could create schemas before recording progress but never ran seeders. Otherwise legacy version history, Chromium storage, or nonempty legacy config requires the intermediate release. Exact custom paths and compatible setup-installation fallback paths are inspected without changing the persisted data location. Unavailable paths, malformed state, and unreadable databases fail closed. Development profiles never inspect production legacy config.

The converter, migrators, renderer, export pipeline, migration IPC, remigration settings action, mapping generator, and exclusive dependencies are removed. Old pending remigration reset markers are quarantined without deleting v2 data. The remaining migration-status reader preserves migrated users' provider access and the legacy file-cleanup seeder. OpenClaw's still-used provider projections remain with their consumer. Preference and BootConfig schema generation, backup restore, normal reset, and all shipped SQLite schema migrations remain intact.

## Alternatives considered

Keeping conversion indefinitely retains its runtime and maintenance cost. Starting a new empty profile hides existing data. A release-page link adds manual platform selection, and a latest-release link eventually points at a version without conversion. A fixed platform-specific installer provides a repeatable upgrade route.

## Consequences

Old users need one intermediate installation. The application launches a browser download; it does not download in the background, install the binary, or claim download completion. GitHub asset availability and OS installation behavior remain external dependencies. Historical conversion status is retained for compatibility, not rewritten or removed.

## Verification

- AC1 — `legacyUpgradeGate.test.ts` verifies the direct asset action, cancel/dismissal, errors, and the handled result preventing bootstrap; `legacyUpgrade.test.ts` verifies the platform/architecture/portable matrix.
- AC2 — `legacyUpgrade.test.ts` verifies empty fresh profiles, completed conversion with old residue, and markerless established v2 profiles using production SQLite migrations.
- AC3 — `legacyUpgrade.test.ts` verifies read-only checks, interrupted conversion including schema-only crashes, custom path discovery, inaccessible paths, malformed status, and development isolation; `dataReset.test.ts` verifies that retired remigration requests do not delete data.
- AC4 — Main and renderer typechecks and `electron-vite build` pass. Affected provider/model edition, OpenClaw, populated-schema cleanup, seeding, reset, IPC, and Settings tests pass. Source/bundle inspection finds no converter or migration window, and shipped SQL files are unchanged.
- AC5 — `pnpm i18n:check` and `pnpm docs:check` pass; the fixed download and upgrade instructions are translated in all main-process catalogs.

Native dialog interaction, actual installer download, and packaged cross-platform upgrade acceptance were not run. Unit coverage and successful production bundling do not establish those outcomes.
