---
description: How this fork consumes upstream CherryHQ/cherry-studio releases without losing The Boss branding
sources:
  - .github/workflows/the-boss-release.yml
  - src/shared/utils/branding.ts
---

# Consuming upstream

This fork tracks `CherryHQ/cherry-studio`. The rebrand was built so upstream stays
cheap to absorb: identity resolves through one module, so upstream edits to the
surfaces *around* it merge cleanly.

## Remotes

```bash
git remote add upstream https://github.com/CherryHQ/cherry-studio.git
git remote set-url --push upstream DISABLED_read_only_upstream
```

The push URL is deliberately disabled — `git remote add` sets one by default, and
pointing it at someone else's repository is an accident waiting to happen.

## Merge, don't rebase

```bash
git fetch upstream main
git merge-tree --write-tree HEAD upstream/main   # dry run: see conflicts first
git merge upstream/main
```

Direct merge, matching the playbook proven in the 1.9.x fork. Rebasing rewrites
fork commits and turns one conflict resolution into one per commit.

**Always dry-run first.** `git merge-tree` reports the conflict set without
touching the working tree; `grep -c CONFLICT` on its output is the whole check.

## Measured conflict surface

Dry-run against `upstream/main`, 7 commits ahead of the fork:

| | |
|---|---|
| Files auto-merged | everything else, incl. `electron-builder.yml` and all 13 locale files × 2 trees |
| **Conflicted** | **`package.json` only** |

The conflict is two fields:

- `name` — ours (`TheBoss`) vs upstream (`CherryStudio`). **Keep ours.**
- `version` — take upstream's, then re-apply any fork-specific suffix.

That `electron-builder.yml` and 26 locale files merge cleanly is the point: the
branding module concentrates identity so upstream's edits land beside ours instead
of on top of them.

## Resolution rules

| Surface | Rule |
|---|---|
| `package.json` `name` | Keep ours. |
| `package.json` `version` | Take upstream's. |
| `src/shared/utils/branding.ts` | Ours — upstream has no such file. |
| `electron-builder.yml` identity | Keep our `appId`/`productName`/`executableName`; take upstream's other changes. |
| i18n catalogs | Take upstream's new keys; keep our product-name values. `pnpm lint` fails on any mismatch. |
| `patches/` | Ours. Re-verify after a dependency bump. |
| Provider/service endpoints | **Take upstream's.** `cherryin`/`cherryai` are real services we consume. |

## Values that are NOT branding

Some Cherry strings are load-bearing and must never be rebranded. Each has a
comment at its definition:

- `LEGACY_UPSTREAM_DIRNAME` (`userDataLocation.ts`) — detects an unadopted
  upstream data directory.
- `ACCEPTED_BACKUP_APP_NAMES` (`LegacyBackupManager.ts`) — accepts pre-rebrand
  backups; changing it makes them unrestorable.
- `isLegacyMcpAutoInstall()` reference URL (`builtinMcpServerSeeder.ts`) —
  identifies legacy rows by their historical value; rebranding it silently stops
  the migration.
- `new URL(..., 'https://www.cherry-ai.com')` — a dummy base for relative-path
  parsing, never navigated to.

The pattern: **a historical value used for detection is input, not identity.**

## After merging

```bash
pnpm install          # patches/ may need re-applying
pnpm lint             # format + typecheck + i18n
pnpm test:main && pnpm test:renderer
```

Never `pnpm test <path>` — that script chains vitest invocations with `&&` and CLI
args reach only the last one.
