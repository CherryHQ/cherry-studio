---
description: Upgrade old profiles through a fixed migration-capable release before starting the current application
sources:
  - src/main/data/migration
  - src/main/core/preboot/legacyUpgradeGate.ts
---

# Upgrading v1 Data

The current application no longer converts v1 Redux, Dexie, or ElectronStore data. Users upgrading from 1.9.x must first install and launch Cherry Studio **2.1.0**, complete its migration, and then reinstall the current version. Keep the existing data directories throughout this process. Users on **1.9.11 or earlier**, or whose old version cannot be identified, must first install and launch **1.9.12**, then launch **2.1.0** to migrate, and finally reinstall the current version.

## Preboot behavior

Before lifecycle bootstrap, `legacyUpgradeGate.ts` checks the current profile and recorded legacy custom directories. Existing databases are opened read-only; the check never creates a database, runs schema migrations, or marks conversion completed. A completed migration takes precedence over leftover legacy files. A v2 database with a runtime seeding journal but no conversion marker is also accepted, allowing profiles created after conversion retirement to restart normally.

Unmigrated or interrupted profiles receive a branded, localized preboot window. Compatible default profiles in packaged native macOS, Windows NSIS, and Linux deb/rpm or writable AppImage installations offer **Install migration version**: download the pinned 2.1.0 artifact for the current edition and architecture, verify it through electron-updater, and hand installation/restart to the native updater. Download can be canceled; failures leave retry and manual download available. During installation handoff, ordinary quit is blocked so it cannot interrupt the updater. Updater cache and bookkeeping stay outside the legacy profile.

Translated processes, unknown Linux package formats, unpackaged builds, and non-portable Windows installations lacking publisher metadata retain manual download. Custom profiles are pinned in BootConfig immediately before handoff so 2.1.0 reopens the selected directory; observable handoff failure restores the prior mapping. Windows portable installations use the dependency-patched PortableUpdater: stage and verify the fixed portable EXE, require valid matching publisher signatures, wait for exit, replace at the original path, and relaunch. The helper restores the previous EXE if replacement or launch fails; adjacent data stays in place. For a recognized v1 version before 1.9.12, the Global Windows x64 portable build offers **Install 1.9.12** when the signed portable release can reopen the same adjacent data directory. Exit 1.9.12 normally after it opens. Cherry Studio then automatically installs and opens the signed 2.1.0 portable release at the same path. Start migration in 2.1.0. Other older or unknown profiles use **Download 1.9.12**. Manual download opens a fixed release asset in the system browser and exits. It selects a DMG on macOS, setup/portable EXE on Windows, or the detected deb/rpm/AppImage format on Linux (unknown formats fall back to AppImage), including native arm64 for translated hosts. Linux package identity comes from electron-builder’s `package-type` marker; package installation and elevation use `DebUpdater` / `RpmUpdater`. The dependency patch uses RPM downgrade commands only for an older target. Packaged acceptance for platforms not exercised remains pending; see the [bridge installation Spec](../../../../.agents/notes/proposed/feature/2026-11-11-preboot-bridge-install.md).

If the default profile is empty and legacy configuration points to an established v2 custom profile, the gate restores its BootConfig mapping and relaunches before bootstrap. The next launch rebuilds the complete path and Chromium session snapshot; no database contents are modified.

Unavailable custom directories, corrupt databases, unreadable migration status, and failure to open the download produce an error and stop startup. Unpackaged development launches never inspect production legacy config. Migration itself still runs only in 2.1.0; the current application never restores the converter.

## Retained compatibility records

`migration_v2_status` remains in `app_state`. `migrationStatus.ts` reads historical records for provider edition access and the legacy file-cleanup policy seeder. Transaction consumers pass their existing database context to the status reader, including during seeding before DbService is ready. These consumers do not load a conversion engine. Existing successful migrations remain valid; deleting the marker is not an upgrade procedure.

The migration renderer, exporters, conversion engine, migrators, migration IPC, and Settings remigration action are removed. Pending remigration reset markers from an older version are rejected and quarantined without deleting v2 data. Normal data reset and backup restoration remain available.

## Schema migrations

SQLite schema evolution is separate from v1 conversion. `DbService` still applies the append-only chain in `migrations/sqlite-drizzle/`. Do not delete or rewrite shipped SQL migrations.

Preference and BootConfig schema generation still runs through `scripts/data-classify/`. It no longer emits v1 conversion mappings.
