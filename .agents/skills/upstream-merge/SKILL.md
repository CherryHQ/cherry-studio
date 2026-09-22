---
name: upstream-merge
description: Merge upstream CherryHQ/cherry-studio main into The Boss fork without losing branding or fork-only work, then record the merge in the log. Use when asked to sync, pull, merge, or update from upstream / Cherry Studio, or to check how far the fork has drifted.
---

# Upstream Merge

Absorb upstream `CherryHQ/cherry-studio` into this fork (The Boss). Rules live in
[`docs/contrib/upstream-merges.md`](../../../docs/contrib/upstream-merges.md) (the playbook) and history in
[`docs/contrib/upstream-merge-log.md`](../../../docs/contrib/upstream-merge-log.md) (the log). Read both before
starting — the log's **Open items** often say what this merge must also handle. This skill is the procedure;
when a rule here and the playbook disagree, the playbook wins and this file gets fixed.

`scripts/check.sh` is read-only and does the mechanical checks:

- `check.sh preflight` — fetch, divergence, dry-run conflicts, files both sides touched, Cherry identity upstream is adding.
- `check.sh verify` — fork files reverted to upstream's copy, Cherry identity the merge added, identity anchors.

## Workflow

### 1. Preflight → verify: report understood

```bash
.agents/skills/upstream-merge/scripts/check.sh preflight
```

Stop and ask if the working tree has changes the merge would touch, or if upstream bumps a dependency that has a
file in `patches/`. Tell the user the upstream commit count, target version, and conflict list before merging.

### 2. Branch and merge → verify: conflict set matches preflight

```bash
git switch -c merge/upstream-$(date +%F)
git merge --no-ff --no-commit upstream/main
```

Never rebase or cherry-pick (playbook: *Merge, don't rebase*). A git hook runs `pnpm install` on checkout/merge;
a hook's non-zero exit can abort a `&&` chain, so re-check `git status` after hooked commands.

### 3. Resolve conflicts → verify: `git diff --name-only --diff-filter=U` is empty

Apply the playbook's **Resolution rules** table. The recurring cases:

- **`package.json`** — keep `name: TheBoss`, take upstream `version`.
- **JSON lists keyed by id** (e.g. `scripts/data-classify/data/target-key-definitions.json`) — do not accept git's
  hunks; they misalign. Diff base/ours/theirs by key (`git show :1:/:2:/:3:<file>`), take upstream's file text,
  and splice the fork's keys in. Keep upstream's order so the next merge doesn't conflict.
- **Generated files** (`preferenceSchemas.ts`, `bootConfigSchemas.ts`, `*Mappings.ts`, `routeTree.gen.ts`) —
  never hand-merge. Resolve their sources, then regenerate (`cd scripts/data-classify && npm run generate`).
  Revert regenerated files whose only diff is the `Generated at:` timestamp.

### 4. Rebrand what upstream added → verify: `check.sh verify` shows only accepted leftovers

```bash
.agents/skills/upstream-merge/scripts/check.sh verify
```

- **LOST?** lines are fork edits upstream's copy overwrote — restore them before anything else.
- New product/assistant names in i18n: rebrand in **every** locale of both trees using the playbook's
  **Naming** table. Edit values only, never keys (`cherry_assistant`, `CherryConfig` are identifiers).
- New user- or model-facing literals in code or `resources/builtin-agents/**`: same table.
- Leave alone: service names (CherryIN, CherryAI, Cherry Cloud, Cherry account), anything in the playbook's
  **Values that are NOT branding**, historical fixtures/hashes, tests and e2e, comments, log messages.
  Anything unhandled goes into the log's **Open items**, not silently dropped.

### 5. Gate → verify: all pass

```bash
pnpm lint
pnpm exec vitest run <tests for every non-locale file in the "both sides changed" list, plus tests asserting anything you rebranded>
```

`pnpm lint` covers typecheck, i18n completeness, and format. Never `pnpm test <path>`. Commit only the formatter's
changes to files you touched.

### 6. Commit → verify: `git cat-file commit HEAD | grep -c gpgsig` is 1

```bash
git commit -S --signoff   # message: chore(upstream-sync): merge upstream main (vX.Y.Z)
```

Body lists each conflict and how it was resolved, and what was rebranded. Fast-forward `main` only if the user
asked for the merge to land there. Never push without being asked.

### 7. Record → verify: `pnpm docs:check` passes

- Add an entry to the top of `docs/contrib/upstream-merge-log.md` (template in that file).
- Update the log's **Open items**: close resolved ones, add new ones.
- If this merge taught a new rule (new conflict shape, new naming case, new non-branding value), add it to
  the playbook — the log records what happened; the playbook records what to do.
- Run `pnpm docs:index` if a doc's frontmatter changed, then `pnpm docs:check`.
