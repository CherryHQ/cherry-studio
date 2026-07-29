# Upgrading the Custom English Learning Fork

This fork keeps Cherry Studio as the application and data owner. Obsidian is an optional export surface; review scheduling, notifications, speaking practice, history ingestion, and model reuse remain inside Cherry Studio.

## Repository layout

- `origin`: personal fork used for pushing custom branches.
- `upstream`: official `https://github.com/CherryHQ/cherry-studio.git`.
- Custom branch: a linear commit stack above `upstream/main`.
- Git rerere: enabled locally to reuse previously recorded conflict resolutions.

## Feature-owned areas

These are mostly additive and should normally survive a rebase without manual merging:

- `src/main/features/englishLearning/`
- `src/renderer/pages/englishLearning/`
- `src/renderer/routes/app/english-learning*.tsx`
- English-learning DataApi services, schemas, handlers, and tests
- English-learning database schemas
- `src/main/ai/speech/` and `src/shared/ai/speech.ts`
- English-learning IPC schemas and handlers

## Upstream integration seams

Review these files deliberately after every upgrade:

| Contract | Current seam |
|---|---|
| Lifecycle services | `src/main/core/application/serviceRegistry.ts` |
| DataApi exposure | `src/main/data/api/handlers/apiHandlers.ts`, `src/shared/data/api/schemas/apiSchemas.ts` |
| IpcApi exposure | `src/main/ipc/handlers/ipcHandlers.ts`, `src/shared/ipc/schemas/ipcSchemas.ts` |
| Translation ingestion | `src/main/data/services/TranslateHistoryService.ts` |
| Selection ingestion | `src/main/data/services/TemporaryChatService.ts`, selection action components |
| App navigation | sidebar registry, launchpad, main-window navigation, generated route tree |
| Preferences | data-classify target definitions and generated preference schemas |
| Localization | main and renderer locale files |
| Database | Drizzle schemas and generated development migrations |

Generated preference mappings must still be changed through
`v2-refactor-temp/tools/data-classify/data/target-key-definitions.json`. Generated Drizzle migrations should be regenerated after resolving upstream schema changes, following the repository migration rules.

## Rehearsal procedure

Keep unrelated working-tree changes out of the rehearsal. From a clean customization commit:

```bash
git fetch upstream main
UPGRADE_WORKTREE="$(mktemp -d)"
git worktree add -b rehearse/english-learning-upgrade "$UPGRADE_WORKTREE" HEAD
git -C "$UPGRADE_WORKTREE" rebase upstream/main
pnpm --dir "$UPGRADE_WORKTREE" install
pnpm --dir "$UPGRADE_WORKTREE" english-learning:check
pnpm --dir "$UPGRADE_WORKTREE" build:check
git worktree remove "$UPGRADE_WORKTREE"
git branch -D rehearse/english-learning-upgrade
```

If the rebase stops on a conflict, inspect it in the temporary worktree. Do not copy the old file wholesale. Preserve the current upstream design, then reconnect the English-learning contract at the replacement seam.

## Required checks

Run:

```bash
pnpm english-learning:check
pnpm build:check
```

`english-learning:check` first verifies structural contracts and then runs the focused data, extraction, review, speaking, navigation, and selection-ingestion tests. `build:check` remains the final repository-wide gate.

## Commit discipline

Keep future custom work in small Conventional Commits. A useful order is:

1. data contracts and schemas;
2. ingestion and extraction;
3. review scheduling and reminders;
4. speaking and model adapters;
5. renderer entry points;
6. upgrade-only conflict adaptations.

This ordering makes individual patches easier to replay, diagnose, or drop when upstream gains an equivalent capability.

