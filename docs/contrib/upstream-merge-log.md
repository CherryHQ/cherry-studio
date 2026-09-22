---
description: Dated record of every upstream CherryHQ/cherry-studio merge into The Boss fork, plus open branding items carried between merges
sources:
  - docs/contrib/upstream-merges.md
  - .agents/skills/upstream-merge/SKILL.md
---

# Upstream merge log

What each merge actually hit. Rules belong in [the playbook](./upstream-merges.md);
this page is history and carry-over. Newest entry first. The `upstream-merge` skill
appends here as its last step.

## Open items

Branding work known to be outstanding. Close an item by moving it into the entry of
the merge (or commit) that fixed it.

- **Release notes** — `electron-builder.yml` `releaseInfo.releaseNotes` is upstream's
  "Cherry Studio X.Y.Z" text, replaced wholesale every release. Needs a fork-owned
  source (e.g. generated in `.github/workflows/the-boss-release.yml`) rather than a
  per-merge edit.
- **Product name in translations** — 42 non-English strings still say "Cherry",
  "Cherry Studio", or "Cherry-Studio" where `en-us` says "The Boss" (as of
  2026-09-22): 28 renderer (`de-de` 7, mostly `settings.dependencies.remove*ConfirmMessage`
  elsewhere) and 14 main-process (`apiGateway.docs.*`, plus 2 in `de-de`).
- **Product name in code and bundled agents** — `apiGateway/app.ts` (`'Cherry Studio API'`),
  two headless reasons in `builtinAgentGuardRules.ts`, and the built-in agents' bundled
  skills (`resources/builtin-agents/cherry-assistant/.claude/skills/**`,
  `resources/skills/cherry-tool-guide/**`).
- **Existing rows keep old names** — the default assistant seeder runs only on a
  fresh database, so installs seeded before the 2026-09-22 rename keep
  "Cherry Assistant". A rename seeder for the default assistant (like the one
  `cherrySupportSeeder` has for `Cherry 支持`) would fix them.

## Entry template

```markdown
## YYYY-MM-DD — upstream vX.Y.Z (<merge commit>)

- **Taken:** N upstream commits, <base>..<upstream sha>
- **Conflicts:** <file> — <resolution>
- **Rebranded:** <what upstream introduced that we renamed>
- **Left as upstream:** <accepted leftovers, and why>
- **Gate:** pnpm lint ✓, <tests run> ✓
- **Lessons:** <new rule added to the playbook, or "none">
```

## 2026-09-22 — assistant rename (follow-up, no upstream commits)

- **Rebranded:** default assistant name (`DEFAULT_ASSISTANT_NAME`, zh `Boss 助手`),
  both built-in agent manifests (names and identity instructions), the runtime
  fallback instructions, the Support guard-rule and error text, and
  `chat.default.name` / Boss Support strings in every locale. English was
  already correct; the other twelve locales still said Cherry.
- **Found:** `DEFAULT_ASSISTANT_NAME` was still `'Cherry Assistant'` while the
  seeder's version hash claimed "Boss", so new users were seeded with the Cherry
  name.
- **Lessons:** added the Naming table and two detection values to the playbook.

## 2026-09-22 — upstream v2.1.2 (`2548629140`)

- **Taken:** 32 upstream commits, merge base `c3eda0c2b2`.
- **Conflicts:**
  - `package.json` — kept `name: TheBoss`, took `version: 2.1.2`.
  - `scripts/data-classify/data/target-key-definitions.json` — both sides only
    added keys (upstream: `shortcut.tab.close`, `shortcut.app.window.close`; fork:
    `app.prometheus.home_push.enabled`). The conflict came from fork commit
    `1937e4ab9d` re-sorting the whole file. Took upstream's text and order and
    appended the fork key.
  - `src/shared/data/preference/preferenceSchemas.ts` — regenerated; three other
    generated files had timestamp-only diffs and were reverted.
- **Rebranded:** three new renderer strings in 13 locales
  (`settings.skills.editor.conflict`, `settings.skills.remote.staleDescription`,
  `settings.skills.enableToTry.description`).
- **Left as upstream:** release notes, e2e and test fixtures, one log message.
- **Gate:** `pnpm lint` ✓; tests for the overlapping files plus the Prometheus and menu tests (272) ✓.
- **Lessons:** keyed-JSON and generated-file rules added to the playbook.
