# Stage 6 — Completion (Trigger-Based; Unscheduled)

## Desktop Relocation: root → `apps/desktop/`

**Trigger condition** (maintainer judgment; either suffices): active branch/worktree count drops to
a coordinable window, or a post-release lull. Symmetry is deferred deliberately — it is an
aesthetic property with real migration cost against ~110 in-flight branches (Invariant I6).

Executed as a single mechanical commit:

- `git mv` desktop-owned root entries → `apps/desktop/`: `src/`, `migrations/`,
  `electron.vite.config.ts`, `tsconfig*.json`, desktop build/packaging config.
- Root `package.json` becomes a pure workspace orchestrator (script forwarding); the desktop
  application manifest moves to `apps/desktop/package.json`.
- Desktop-only packages (`ui`, `dsh-bridge`, `extension-table-plus`, `mcp-trace`) →
  `apps/desktop/packages/`; from this point root `packages/` contains shared-tier packages only,
  and the transitional co-location noted in the README ends.
- Git rename detection resolves most rebases of in-flight branches automatically; execution still
  requires an all-hands announcement and a low-activity window.

## Exit Criteria (all must hold — monorepo migration is complete)

```bash
grep -r "@cherrystudio/mobile-" --include='*.ts*' apps/ | wc -l        # == 0  (debt prefixes cleared)
grep -rl "export \* from '@cherrystudio/" src/shared | wc -l           # == 0  (strangler shims amortized)
test ! -f apps/mobile/desktop-sync-manifest.json                       # manifest retired
```

## Decommissioning Ledger (items retire as stages progress; consolidated here for final audit)

| Artifact / mechanism | Retirement point |
|---|---|
| `apps/mobile/desktop-sync-manifest.json` | Domain entries cleared per unification; file deleted when empty |
| `apps/mobile/scripts/desktopSyncAudit.ts` + `desktop:sync:audit` script | With manifest deletion |
| `apps/mobile/scripts/oauthDesktopSyncAudit.ts` + oauth `desktop-sync-map.json` | Track B first cut (oauth) completion |
| `packages/design-tokens/scripts/sync-desktop.ts` + `src/sync-manifest.json` | Stage 2a desktop adoption completion |
| `apps/mobile/packages/ai-runtime/desktop-sync-map.json` | After Track A Wave 3 (retained meanwhile as the package membership registry) |
| Mobile `port-bot.yml` workflow | Stage 1b-6 (already decommissioned at landing) |
| `sync-cherry-desktop` agent skill (mobile `.agents`) | With manifest deletion |
| Origin repository `cherry-studio-app` | Frozen and archived at Stage 1 cutover (not deleted; historical `v0.x` tags remain resolvable there) |
| This directory (`mobile-migration-temp/`) | When all exit criteria hold |

## Residual Ledger (recorded, deliberately unscheduled)

- AI directories `channels`, `inference`, `contextBuild`, `observability`, `skills`: graduate via
  Track A Wave 3 procedure when the mobile roadmap schedules each feature.
- `lanTransfer/` protocol-layer sharing (Track B, Bucket C note).
- Data-service execution-shell unification (Track C terminal evaluation).
- Disposition of the 85 single-platform UI components (Track D quarterly review).
- Desktop `packages/aiCore` directory rename → `ai-core` (kebab-case conformance; piggyback on the
  Stage 6 relocation commit).
- File-processing orchestration sharing: cloud processors (`doc2x`, `mineru`, `openMineru`,
  `mistral`, paddleocr-API, `ovocr`) are pure HTTP and directly shareable; local leaves stay
  per-platform (desktop Node libraries vs mobile `modules/pdf-text-extractor` native module);
  measured port surface: 2 methods (`extractText`, file read).
