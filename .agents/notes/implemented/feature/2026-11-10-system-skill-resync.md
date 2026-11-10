# Agent Note: System skill re-sync from its file origin

Status: implemented

English | [中文](2026-11-10-system-skill-resync.zh.md)

## Problem

A system import copies the source folder into the managed library, so a later `git pull` in `~/.claude/skills` left the installed copy stale. `checkRemoteUpdate` answered `not_remote` for every non-marketplace skill, and `importSystem` refused an already imported directory with `System skill is already imported`. The only workaround was uninstall plus re-import, which hard-deletes the row, cascades away every `agent_skill` row, and inserts a new skill id — silently disabling the skill for every agent that had it enabled.

## Decision

A system skill whose origin is a local directory is now an updateable source that keeps its identity:

- `hasSkillLocalUpdateProvenance` (`src/shared/utils/skillMarketplace.ts`) treats `source === 'system'` with a `file:` `sourceUrl` and a directory content hash as update provenance, alongside the unchanged marketplace rule.
- `checkRemoteUpdate` and `applyRemoteUpdate` (`src/main/ai/skills/SkillService.ts`) accept `system` skills through a local fetch: the `file:` URL is resolved with `realpath`, rejected when it points inside the managed library or the mirror root or is not a directory, and hashed like a marketplace fetch. Revision, `localChanges`, and explicit-overwrite semantics are identical to marketplace updates, and the same row id, `agent_skill` rows, and mirror are preserved.
- `importSystem` re-importing an already registered origin no longer throws. It re-syncs in place (`resyncSystemSkillLocked`): it verifies the persisted origin still resolves to the discovered directory, replaces the managed files, refreshes name, description, version, tags, content hash, canonical `sourceUrl`, and namespace, then re-links the mirror and notifies the projection. An explicit re-import unconditionally replaces managed-copy edits; the check/apply path still requires the overwrite flag when local changes exist.
- Renderer: the SkillDetails "Check for updates" entry is offered for `system` skills, `useSystemSkills.importSkill` accepts registered candidates, and the system dialog's Import action re-syncs an already imported skill. Only a folder-name conflict stays blocked.

## Alternatives considered

- Reference registration instead of copying (tracked in #21202) removes the sync step entirely but is a larger change and still needs a "source changed" signal, so it does not cover this ask.
- A file watcher reconciling the database with disk (tracked in #14233) changes the ownership model more deeply than an explicit update path.
- Keeping uninstall plus re-import as the only path permanently loses per-agent enablement on every source change.

## Consequences

No new IPC route, schema, or `SkillRemoteUpdateCheck` variant is needed; `not_remote` now applies only to sources that are neither marketplace nor system. A local path can only overwrite the managed copy of the skill row whose persisted `file:` origin resolves to that same directory, and never a path inside the managed library or mirror roots. Re-sync keeps the skill id, so existing agent enablement survives source changes without per-agent repair.

## Verification

- AC1 — `src/main/ai/skills/__tests__/SkillService.authoring.test.ts`: a system skill whose file origin moved reports `available` with `localChanges`, refuses implicit overwrite with `REMOTE_LOCAL_CHANGES`, and applies explicitly while preserving the skill id and the `agent_skill` row.
- AC2 — `src/main/ai/skills/__tests__/SkillService.authoring.test.ts`: a system skill whose origin matches the install baseline reports `up_to_date`, and non-file system URLs plus local sources return `missing_provenance`/`not_remote` without touching the network.
- AC3 — `src/main/ai/skills/__tests__/SkillService.test.ts`: re-importing the same system origin replaces the managed copy, keeps the skill id, and preserves agent enablement.
- AC4 — `src/renderer/hooks/__tests__/useSkills.test.ts` and `src/renderer/components/resourceCatalog/dialogs/skill/__tests__/SystemSkillDialog.test.tsx`: registered system skills can be re-imported from the hook and the dialog, while folder-name conflicts stay blocked; `npx tsc --noEmit` and `npx eslint` on the touched files pass.
