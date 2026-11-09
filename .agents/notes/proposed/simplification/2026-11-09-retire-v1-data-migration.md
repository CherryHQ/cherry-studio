# Agent Note: Retire v1 data migration

Status: proposed

English | [中文](2026-11-09-retire-v1-data-migration.zh.md)

## Problem

The application still ships a complete v1-to-v2 conversion engine, migration window, IPC, preload, and renderer despite v2 being established. Removing conversion must not cause users upgrading from 1.9.x to start with an empty profile.

## Proposal

Replace the conversion entry point with a small preboot compatibility gate before application bootstrap. Keep the minimum read-only legacy-data and migration-status detection, including legacy custom data locations. Unmigrated or partially migrated profiles stop startup; the gate never creates a database or marks migration completed merely to classify a profile. A completed v2 migration takes precedence over leftover v1 files. Fresh profiles and established v2 profiles proceed normally.

Offer localized native dialog actions to download the migration-capable version or quit. The download action opens https://github.com/CherryHQ/cherry-studio/releases/tag/v2.1.10 in the system browser, then quits. Explain that users must install and launch v2.1.10, complete migration, and then reinstall the newer version. Closing the dialog also quits. This fixed release contains the migration engine and is the latest published release verified during preparation; verify the cutoff again before implementation ships.

If an old custom data directory is inaccessible, or migration status cannot be read, stop with an actionable error instead of treating the profile as empty. Preserve development-profile isolation. Do not modify legacy data, redirect the persistent data location, or initialize an empty v2 database on a blocked launch.

Delete v1 conversion engines and migrators, migration UI and transport, migration-only exports, build entries, dependencies, tests, and generated mapping outputs whose only consumer is retired. Update generator owners before regenerating affected artifacts. Preserve shared helpers still used outside migration, current preference and BootConfig generation, backup restoration, and all shipped SQLite schema migrations. Update affected current reference documentation and preserve historical Agent Notes.

## Alternatives considered

Retaining conversion indefinitely keeps its runtime and maintenance costs. Silently continuing with a new profile makes existing data appear lost. Linking to the latest release is unstable because that release will eventually lack conversion. A fixed migration-capable release gives users a repeatable upgrade route.

## Acceptance criteria

- AC1 — An unmigrated 1.9.x profile is blocked before bootstrap and receives the fixed download link and upgrade instructions; download, quit, and dialog dismissal never start the application. (verification: unit and Electron)
- AC2 — Fresh profiles and completed v2 profiles, including those with leftover legacy files, start normally without conversion. (verification: unit and Electron)
- AC3 — Custom legacy paths, unavailable paths, unreadable status, and incomplete migration cannot silently become a fresh profile; blocked probes leave business data and migration status unchanged. Development isolation remains effective. (verification: unit with filesystem and database fixtures)
- AC4 — Production bundles no longer include the v1 conversion system or migration window; retained consumers compile and shipped SQLite migrations remain unchanged. (verification: scoped typecheck, build inspection, and diff review)
- AC5 — The native prompt is localized and affected bilingual documentation describes the fixed intermediate upgrade route. (verification: locale checks and docs gate)

## Risks

A stale migration marker or legacy-path heuristic can incorrectly classify a profile. Tests must include completed migration with legacy residue and interrupted conversion, using real persisted fixtures. The intermediate release must remain downloadable and support the user's platform. Tag source inspection establishes that conversion exists, but packaged upgrade behavior still requires verification before shipping. Users must retain their data while installing the intermediate application version.
