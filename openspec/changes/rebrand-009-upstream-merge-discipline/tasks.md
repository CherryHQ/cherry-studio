# Tasks — rebrand-009-upstream-merge-discipline

- [x] Implement per plan.md
- [x] Verify acceptance criteria
- [x] pnpm lint

## Deliverable

`docs/contrib/upstream-merges.md` — remote setup, merge-not-rebase rationale,
per-surface resolution rules, and the post-merge verification sequence.

## G5 proved, not asserted

Dry-run against `upstream/main`, **7 commits ahead** of the fork:

```
git merge-tree --write-tree HEAD upstream/main
```

| Result | |
|---|---|
| Auto-merged | everything else, including `electron-builder.yml` and **all 13 locale files × 2 trees** |
| **Conflicted** | **`package.json` only** |

The single conflict is two predictable fields: `name` (ours) and `version`
(upstream's 2.1.2 vs our 2.1.1).

This is the empirical answer to the phase's central question. 828 rebranded i18n
values and a fully rebranded `electron-builder.yml` merged **without conflict**,
because identity resolves through `src/shared/utils/branding.ts` rather than
through literals scattered across the tree. That was G1's whole purpose, and the
dry-run is the evidence it worked.

## Documented: values that are not branding

The playbook names the four historical values that must never be rebranded —
legacy data-dir detection, backup-format acceptance, legacy MCP row detection,
and the `new URL()` parsing base. Two of these were caught by tests mid-phase
after being wrongly rebranded, so the doc records the distinction:
**a historical value used for detection is input, not identity.**

## Evidence

- Dry-run conflict set captured above
- `upstream` remote configured with its push URL disabled
- `pnpm docs:check` → exit 0 (links, structure, frontmatter, generated index)
