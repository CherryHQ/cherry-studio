# Agent Note: Let users stop exporting skills into the shared external skills directory

Status: implemented

English | [中文](2026-11-11-external-skill-export-app-switch.zh.md)

## Problem

Cherry Studio mirrors bundled and user-installed skills into `~/.agents/skills`, the directory other agent tools read. Nothing in the product could stop that mirroring. A user who deleted the links found them back after the next reconcile, and a user who never wanted the directory touched had no switch at all. The per-skill `agent_global_skill.mirror_enabled` column only turned individual skills off, so keeping the directory clean required one toggle per skill and re-arming every new bundled skill.

## Decision

An app-level preference, `agent.skills.external_export.enabled` (boolean, default `false`), gates skill export operations. A fresh install does not export by default. Upgrades with existing preferences retain exports when the new key is absent; an existing choice is preserved. The gate covers install, reinstall, reconcile, per-skill switches, remote updates, and bundled skills. Preboot user-data relocation does not read the preference and can still redirect this app’s residual old links.

While the preference is off, skill export operations do not create or restore links, and remove links matching this app’s skill names and targets while leaving other entries untouched. Turning the preference back on honors each skill's stored `mirror_enabled` value, so per-skill choices survive the app-level switch instead of being flattened. The skill detail page keeps its own checkbox, disabled and explained while the app-level switch is off.

## Alternatives considered

Removing the export feature would break the interop it exists for. Keeping only per-skill control leaves users no way to stop bulk export, and new bundled skills would keep re-appearing. Storing the app-level flag in SQLite would need a migration for a value that the preference store already persists. Deleting the whole directory while off would destroy links and files that other tools or the user own.

## Consequences

Existing installations with preferences retain export on upgrade unless they already have a saved choice. Fresh installs do not export to `~/.agents/skills` until the switch is enabled. When the switch is off, links owned by this app disappear while foreign entries stay. A crash between removing a link and updating the catalog row leaves nothing to repair, because reconcile removes only entries this app can prove it created. Links created by an older version are recognized as app-owned by their target path, so upgrading does not leave orphans behind.

## Verification

- Regression — `src/main/ai/skills/__tests__/SkillService.test.ts` "external export preference" cases: the five paths below fail before the change and pass after it; the file passes with the rest of the focused main set (6 files, 317 tests).
- Regression — With the preference off, `setMirrorEnabled(id, true)` resolves without touching the external directory, and `reconcile` removes this app's links while keeping a user-created file and directory.
- Regression — `src/renderer/pages/settings/__tests__/SkillsSettings.test.tsx` and `SkillDetails.test.tsx` cover the switch row and the disabled, overridden per-skill checkbox (3 files, 24 tests).
- Regression — An earlier tracked Electron run with the previous default enabled and an isolated `HOME` starts with 10 app-owned links, removes all of them when the switch is turned off in Settings while a user file and directory survive, re-imports nothing after a restart, and restores the same 10 links when the switch is turned back on.

- Regression — `ExternalSkillExportUpgradeSeeder.test.ts` and `PreferencesMigrator.test.ts` cover fresh installs, retained choices, registry order, and v1 imports.
