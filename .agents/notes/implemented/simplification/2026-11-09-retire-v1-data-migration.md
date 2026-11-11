# Agent Note: Retire v1 data migration

Status: implemented

English | [中文](2026-11-09-retire-v1-data-migration.zh.md)

## Problem

Shipping the complete v1-to-v2 converter indefinitely retains an obsolete conversion engine, UI, and transport. Simply deleting the preboot gate can make an unmigrated profile look like a fresh installation and hide existing data.

## Decision

The application retains read-only legacy profile detection and directs unmigrated users through Cherry Studio **2.1.0**. This fixed release contains the converter and the required platform assets. The branded preboot window offers a direct installer download or quit, before lifecycle bootstrap. The download action opens the fixed asset URL in the system browser and exits; dismissing the dialog also exits. Users install and launch the intermediate release, complete its migration, then reinstall the current version while preserving their data.

Installer selection uses operating system and architecture: macOS DMG, Windows setup or portable EXE matching the current installation, and Linux AppImage. Both x64 and arm64 are supported. Electron's ARM translation detection selects arm64 when an ARM computer runs an x64 application under Rosetta or WOW. No release page or moving latest-version link is involved.

Completed conversion status takes precedence over residual v1 files. A markerless database is recognized as established v2 only when it contains runtime seeding journal entries: the retired conversion engine could create schemas before recording progress but never ran seeders. Otherwise legacy version history, Chromium storage, or nonempty legacy config requires the intermediate release. Exact custom paths and compatible setup-installation fallback paths are inspected read-only. Established v2 custom profiles recover their BootConfig mapping and relaunch before bootstrap to rebuild the path snapshot. Unavailable paths, malformed state, and unreadable databases fail closed. Development profiles never inspect production legacy config.

The converter, migrators, renderer, export pipeline, migration IPC, remigration settings action, mapping generator, and exclusive dependencies are removed. Old pending remigration reset markers are quarantined without deleting v2 data. Transaction callers pass their database context to the migration-status reader before DbService readiness. The remaining migration-status reader preserves migrated users' provider access and the legacy file-cleanup seeder. OpenClaw's still-used provider projections remain with their consumer. Preference and BootConfig schema generation, backup restore, normal reset, and all shipped SQLite schema migrations remain intact.

The proposed [preboot bridge installation](../../proposed/feature/2026-11-11-preboot-bridge-install.md) replaces only the browser-download interaction after validation; the current decision remains in force.

## Alternatives considered

Keeping conversion indefinitely retains its runtime and maintenance cost. Starting a new empty profile hides existing data. A release-page link adds manual platform selection, and a latest-release link eventually points at a version without conversion. A fixed platform-specific installer provides a repeatable upgrade route.

## Consequences

Users on 1.9.11 or earlier, or without an identifiable old version, must first install and launch 1.9.12 before migrating through 2.1.0. The window offers both direct installers. The application launches a browser download; it does not download in the background, install the binary, or claim download completion. GitHub asset availability and OS installation behavior remain external dependencies. Historical conversion status is retained for compatibility, not rewritten or removed.

## Verification

- AC1 — `legacyUpgradeGate.test.ts` verifies fixed installer choices, recovery restart, persistence failures, errors, and the handled result preventing bootstrap; `legacyUpgradeWindow.test.ts` covers direct download, quit, sender validation, and IPC cleanup; `legacyUpgrade.test.ts` verifies the platform/architecture/portable matrix.
- AC2 — `legacyUpgrade.test.ts` verifies empty fresh profiles, completed conversion with old residue, and markerless established v2 profiles using production SQLite migrations.
- AC3 — `legacyUpgrade.test.ts` verifies read-only checks, interrupted conversion including schema-only crashes, custom path discovery and established-profile recovery, inaccessible paths, malformed status, and development isolation; `dataReset.test.ts` verifies that retired remigration requests do not delete data.
- AC4 — Main and renderer typechecks and `electron-vite build` pass. Affected provider/model edition, OpenClaw, populated-schema cleanup, seeding, reset, IPC, and Settings tests pass. Source/bundle inspection finds no converter or migration window, and shipped SQL files are unchanged.
- AC5 — `pnpm i18n:check` and `pnpm docs:check` pass; the fixed download and upgrade instructions are translated in all main-process catalogs.

The branded preboot window was exercised in an isolated macOS Electron profile in light and dark themes: the quit action exited without creating a SQLite database, and arbitrary download URLs were rejected. Actual installer download/install and packaged cross-platform upgrade acceptance were not run.
