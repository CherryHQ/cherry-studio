# Agent Note: User notes for installed skills

Status: implemented

English | [中文](2026-11-09-skill-user-note.zh.md)

## Problem

Users need a personal reminder for an installed skill without changing its author's metadata, search behavior, or invocation identity. The reminder must persist and be shared across Agent views of that installed skill.

## Decision

Store one user note per installed skill ID in the nullable TEXT column `agent_global_skill.note`, added by the appended migration `0036_yummy_arclight.sql`. All Agent views share that row. The note exists only in the database: it does not enter SKILL.md, frontmatter, contentHash, or exported skill ZIP files.

`PATCH /skills/:skillId` accepts a partial update with `isGlobalEnabled?` and `note?`, requiring at least one field. Notes are trimmed; empty strings, whitespace-only strings, and null normalize to SQL NULL. Omitted fields retain their values, and a combined patch updates both fields atomically.

Display the note on Settings skill list cards, Agent creation/edit pickers, and the Composer skill submenu and root search results, which use the same item collection. Settings skill details provide the fourth surface: a separate note editor with explicit saving. An empty note leaves existing rendering unchanged. Summaries truncate to one line, and the existing `Tooltip` shows the full text in place. Notes stay outside every search, sort, and filter input.

## Alternatives considered

- Reuse the SKILL.md description: rejected because it is author metadata and changing it would affect search and the skill package.
- Store notes in a separate table: rejected because the one-to-one relationship needs no separate lifecycle or join.
- Store a note per Agent: rejected because the user reminder belongs to the installed skill ID and must be shared across Agent views.

## Consequences

Uninstalling a skill or deleting its directory through reconcile deletes the database row and its note. Reinstallation does not restore the note.

Pi and Pi Durable connection signatures include the complete DTOs of enabled skills and `updatedAt`. Saving a note therefore rebuilds affected warm connections at the next reconcile. Saving during the startup window can trigger the existing `configuration changed during startup` error and require a retry. Issue #22017 explicitly accepts this cost; runtime behavior is unchanged. Lists sorted by update time can move a skill after its note is saved.

The real-device probe verifies database persistence, list/detail display, full Tooltip text, and a complete application restart. Agent creation/edit pickers and the Composer submenu have component-test coverage only. Real skill invocation, Pi/Pi Durable warm-connection rebuilds and startup races, and cross-window refresh remain unverified.

## Verification

The entries below record executed commands from this fixup and the previous implementation round. Counts for commands selecting multiple files are aggregate counts, not per-file claims. Earlier failed attempts are distinguished from successful reruns.

- Regression — `NODE_OPTIONS=--max-old-space-size=8192 node node_modules/typescript/bin/tsc --noEmit -p tsconfig.web.json --composite false --incremental false`: exit 0, 0 errors.
- Regression — `NODE_OPTIONS=--max-old-space-size=8192 node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false --incremental false`: exit 2, only the pre-existing unrelated `AgentSessionRuntimeService.ts(1083,71) TS2322` (`UIMessageChunk | undefined`); that file is outside this issue.
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/components/resourceCatalog/catalog/__tests__/ResourceGrid.test.tsx`: exit 0, 1 file / 40 tests passed; note display and removal are checked.
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx`: exit 0, 1 file / 159 tests passed; submenu/root display, note-only search rejection, and the disabled-install/local-name counterexample are checked.
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/components/resourceCatalog/dialogs/skill/__tests__/SkillCatalogPicker.test.tsx`: exit 0, 1 file / 7 tests passed; clicking/focusing a note preserves the creation checkbox state.
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/hooks/__tests__/useSkillLauncher.test.tsx src/renderer/hooks/resourceCatalog/__tests__/useResourceCatalogController.test.tsx`: exit 0, 2 files / 27 tests passed.
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/pages/settings/SkillDetails/__tests__/SkillDetails.test.tsx src/renderer/hooks/__tests__/useSkills.test.ts`: exit 0, 2 files / 30 tests passed.
- Regression — `node --import tsx scripts/i18n-check.ts`: exit 0, 101696 translations checked.
- Regression — `node node_modules/drizzle-kit/bin.cjs check --config /Volumes/cherrydev/development/cherry-studio/worktrees/issue-22017/migrations/sqlite-drizzle.config.ts`: exit 0, `Everything's fine`.
- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/data/api/handlers/__tests__/skills.test.ts src/main/ai/skills/__tests__/SkillService.test.ts src/main/ai/skills/__tests__/SkillService.authoring.test.ts src/main/data/db/__tests__/applyMigrations.populated.test.ts`: previous round, exit 0; Test Files  4 passed (4); Tests  203 passed (203).
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/hooks/__tests__/useSkills.test.ts src/renderer/hooks/resourceCatalog/__tests__/skillAdapter.test.ts src/renderer/hooks/__tests__/useSkillLauncher.test.tsx src/renderer/pages/settings/SkillDetails/__tests__/SkillDetails.test.tsx src/renderer/pages/settings/SkillDetails/__tests__/SkillFileBrowser.test.tsx src/renderer/components/resourceCatalog/dialogs/skill/__tests__/SkillCatalogPicker.test.tsx src/renderer/components/resourceCatalog/catalog/__tests__/ResourceGrid.test.tsx src/renderer/components/QuickPanel/__tests__/row.test.tsx`: previous round, exit 0; Test Files  8 passed (8); Tests  100 passed (100).
- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/data/db/__tests__/skillNoteMigration.test.ts`: previous round, exit 0; Test Files  1 passed (1); Tests  1 passed (1).
- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/data/api/handlers/__tests__/skills.test.ts`: previous round, exit 0; Test Files  1 passed (1); Tests  3 passed (3).
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx src/renderer/components/composer/variants/__tests__/agentComposerTokens.test.ts src/renderer/components/composer/quickPanel/__tests__/unifiedPanel.test.ts src/renderer/components/QuickPanel/__tests__/row.test.tsx src/renderer/components/QuickPanel/__tests__/view.test.tsx src/renderer/components/QuickPanel/__tests__/defaultStrategies.test.ts src/renderer/components/resourceCatalog/dialogs/create/steps/__tests__/CapabilityStep.test.tsx src/renderer/components/resourceCatalog/dialogs/edit/__tests__/EditDialogs.test.tsx src/renderer/pages/settings/SkillDetails/__tests__/SkillDetails.test.tsx`: previous round, exit 1; Test Files  1 failed | 8 passed (9); Tests  11 failed | 344 passed (355). The old Composer mock lacked the new note map; its successful standalone rerun is recorded separately.
- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/runtime/pi/piConnectionSignature.test.ts src/main/ai/runtime/pi/PiRuntimeConnection.test.ts src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.test.ts src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts src/main/ai/runtime/claudeCode/__tests__/skillDependencies.test.ts`: previous round, exit 0; Test Files  6 passed (6); Tests  439 passed (439).
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/components/resourceCatalog/dialogs/skill/__tests__/SkillCatalogPicker.test.tsx`: previous round, exit 0; Test Files  1 passed (1); Tests  6 passed (6).
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx`: previous round, exit 0; Test Files  1 passed (1); Tests  158 passed (158).
- Regression — `node node_modules/vitest/vitest.mjs run --project shared src/shared/data/api/schemas/__tests__/skills.test.ts`: previous round, exit 0; Test Files  1 passed (1); Tests  2 passed (2).
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/pages/settings/SkillDetails/__tests__/SkillDetails.test.tsx src/renderer/components/resourceCatalog/dialogs/skill/__tests__/SkillCatalogPicker.test.tsx`: previous round, exit 0; Test Files  2 passed (2); Tests  15 passed (15).
- Regression — `node --import tsx scripts/docsGovernance/verify-translation-pairing.ts --write .agents/notes/implemented/feature/2026-11-09-skill-user-note.md`: exit 0.
- Regression — `node --import tsx scripts/docsGovernance/verify-translation-pairing.ts .agents/notes/implemented/feature/2026-11-09-skill-user-note.md`: exit 0.
- Regression — `node --import tsx scripts/docsGovernance/verify-agent-note-format.ts`: exit 0.
- Regression — `node --import tsx scripts/docsGovernance/verify-doc-structure.ts`: exit 0.
- Regression — `node --import tsx scripts/docsGovernance/verify-doc-frontmatter.ts`: exit 0.
- Regression — `node --import tsx scripts/docsGovernance/check-doc-links.ts`: exit 0.
- Regression — `CHERRY_EDITION=global node node_modules/electron-vite/bin/electron-vite.js build`: succeeded; the application launched as a real Electron process after `pnpm rebuild:electron` switched the ABI; the ABI was switched back after the run.
- Regression — `node /Volumes/cherrydev/development/cherry-studio/worktrees/.tasks/issue-22017/round-1/e2e/note-probe.cjs /Volumes/cherrydev/development/cherry-studio/worktrees/issue-22017 /Volumes/cherrydev/development/cherry-studio/worktrees/.tasks/issue-22017/round-1/e2e/out`: used an isolated profile and the product's own `skill.install_from_directory` route to install the repository sample skill `tests/e2e/regression/fixtures/skill-sample`.
- Regression — `note-probe.cjs`, Settings → Skills → sample skill details: saved the multiline `User note` input successfully; the UI showed `Saved`.
- Regression — `note-probe.cjs`, Settings skill list: after saving, a single-line truncated summary (`Use this one for release no…`) appeared beside the skill name; hovering over it displayed the complete note in the Tooltip.
- Regression — `note-probe.cjs`, complete application process exit and restart: the list summary and detail-page input retained the same note (`afterRestartNotePersisted: true`).
- Regression — machine-readable evidence: `round-1/e2e/out/probe-report.json` records `listShowsNote: true`, `afterRestartListShowsNote: true`, and `afterRestartNotePersisted: true`; `round-1/e2e/probe.log` reports `tooltipMentionsTail: true` (stored as `tooltipText: true` in the JSON). Screenshots are in `round-1/e2e/out/shots/` (01/02/04/05/06/07/08).
- Regression — still unverified: real-device screenshots of Agent creation/edit pickers and the Composer submenu (component tests only); real skill invocation (the model side of AC4); Pi / Pi Durable warm-connection rebuilds and startup races; cross-window refresh.
