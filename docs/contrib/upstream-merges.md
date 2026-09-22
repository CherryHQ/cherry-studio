---
description: How this fork consumes upstream CherryHQ/cherry-studio releases without losing The Boss branding
sources:
  - .github/workflows/the-boss-release.yml
  - src/shared/utils/branding.ts
  - .agents/skills/upstream-merge/SKILL.md
---

# Consuming upstream

This fork tracks `CherryHQ/cherry-studio`. The rebrand was built so upstream stays
cheap to absorb: identity resolves through one module, so upstream edits to the
surfaces *around* it merge cleanly.

This page holds the rules. The step-by-step procedure is the `upstream-merge` skill
(`.agents/skills/upstream-merge/`), and what each past merge hit is in the
[merge log](./upstream-merge-log.md).

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

## Expected conflict surface

`.agents/skills/upstream-merge/scripts/check.sh preflight` reports the real set; the
[merge log](./upstream-merge-log.md) has each merge's actual conflicts. Recurring ones:

- `package.json` — `name` and `version`, every release.
- `scripts/data-classify/data/target-key-definitions.json` — whenever both sides add
  preference keys. Its generated output `src/shared/data/preference/preferenceSchemas.ts`
  conflicts alongside it.

`electron-builder.yml` and the locale files normally auto-merge: the branding module
concentrates identity so upstream's edits land beside ours instead of on top of them.
Auto-merged does not mean on-brand — upstream's *new* strings arrive with Cherry names
and need the Naming table below.

## Resolution rules

| Surface | Rule |
|---|---|
| `package.json` `name` | Keep ours. |
| `package.json` `version` | Take upstream's. |
| `src/shared/utils/branding.ts` | Ours — upstream has no such file. |
| `electron-builder.yml` identity | Keep our `appId`/`productName`/`executableName`; take upstream's other changes. |
| i18n catalogs | Take upstream's new keys; keep our product-name values. `pnpm lint` fails on any mismatch. |
| `patches/` | Ours. Re-verify after a dependency bump. |
| Keyed JSON lists (`target-key-definitions.json`) | Take upstream's file text and order; splice our keys in. Never re-sort the file — a re-sort makes every upstream addition conflict. |
| Generated files (`preferenceSchemas.ts`, `bootConfigSchemas.ts`, `*Mappings.ts`) | Never hand-merge. Resolve the sources, run `cd scripts/data-classify && npm run generate`, revert timestamp-only diffs. |
| Provider/service endpoints | **Take upstream's.** `cherryin`/`cherryai` are real services we consume. |

## Naming

| Upstream | Ours |
|---|---|
| Cherry Studio | The Boss |
| Cherry Assistant (zh `Cherry 助手` / `Cherry 小助手`) | Boss Assistant (zh `Boss 助手`) |
| Cherry Support (zh `Cherry 支持`) | Boss Support (zh `Boss 支持`) |

Translations keep the locale's own word order and substitute only the name —
`Assistant Cherry` → `Assistant Boss`, `Cherry アシスタント` → `Boss アシスタント`,
`Cherry 助理` → `Boss 助理`. Change i18n **values**, never keys: `cherry_assistant`,
`cherry_support`, `CherryConfig`, `cherry-tools` are identifiers.

Also rebranded: the built-in agent manifests (`resources/builtin-agents/*/agent.json`
and `agent-template.json`), `DEFAULT_ASSISTANT_NAME`, and the runtime's fallback
instructions — the model introduces itself by these names.

Not rebranded: service names we consume (CherryIN, CherryAI, Cherry Cloud,
"Cherry account"), comments, log messages, tests, e2e fixtures.

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
- `existing.name === 'Cherry 支持'` (`cherrySupportSeeder.ts`) — renames rows seeded
  under the old zh name.
- `LEGACY_STOCK_SOUL_SHA256_BY_SIZE` (`BuiltinAgentProvisioner.ts`) and the SOUL
  fixtures under `builtin/__tests__/fixtures/` — byte-exact hashes of historical
  personas; editing them stops the upgrade.

The pattern: **a historical value used for detection is input, not identity.**

## After merging

```bash
pnpm install          # patches/ may need re-applying
pnpm lint             # format + typecheck + i18n
pnpm test:main && pnpm test:renderer
```

Never `pnpm test <path>` — that script chains vitest invocations with `&&` and CLI
args reach only the last one.
