# KBD Constraint Configuration — CherryStudio

Project-specific constraint rules for KBD, derived from `CLAUDE.md`
(`AGENTS.md` is a symlink to it) and the repo's verified tooling.

> **Command environment policy.** `package.json` requires Node `>=24.11.1 <24.16.0`
> and `.npmrc` sets `engine-strict=true`. Every `pnpm` command below is prefixed to
> select the required version. Do not weaken this prefix to whatever version happens
> to be active. The prefix is repeated for each command segment in a chain — a prefix
> on the first command does not carry across `&&`.

---

## Blocking Constraints (prevent archiving until resolved)

```yaml
constraints:
  - id: lint-gate-passes
    severity: blocking
    description: 'pnpm lint must pass — covers oxlint, eslint, typecheck, i18n:check, and format'
    command: 'source "$HOME/.nvm/nvm.sh" && nvm use 24.11.1 >/dev/null && pnpm lint'

  - id: no-console-log
    severity: blocking
    description: 'All logging routes through loggerService.withContext(...) — never console.log'
    check: "grep -rn 'console\\.log' src/ --include='*.ts' --include='*.tsx'"

  - id: no-hardcoded-secrets
    severity: blocking
    description: 'No hardcoded API keys, tokens, or passwords in source'
    check: "grep -rnE 'sk-[A-Za-z0-9]{20,}|api[_-]?key\\s*[:=]\\s*[\"\\x27][A-Za-z0-9]{16,}' src/"

  - id: no-adhoc-paths
    severity: blocking
    description: "Main-process paths come from application.getPath('namespace.key') — never app.getPath(), os.homedir(), or ad-hoc construction"
    check: "grep -rn 'app\\.getPath(\\|os\\.homedir()' src/main/ --include='*.ts'"

  - id: no-hardcoded-ui-strings
    severity: blocking
    description: 'All user-visible strings use i18next; i18n:check rejects placeholders, empty values, interpolation mismatches, and unsorted keys'
    command: 'source "$HOME/.nvm/nvm.sh" && nvm use 24.11.1 >/dev/null && pnpm i18n:check'

  - id: no-edited-shipped-migrations
    severity: blocking
    description: 'Migrations in migrations/sqlite-drizzle/ shipped with v2.0.0-rc.1 and run against real user rows. Schema changes are NEW appended migrations from pnpm db:migrations:generate — never edit, renumber, or wipe an existing one.'
    command: 'source "$HOME/.nvm/nvm.sh" && nvm use 24.11.1 >/dev/null && pnpm db:migrations:check'

  - id: no-handedited-generated-files
    severity: blocking
    description: 'Four data-classification outputs are auto-generated. Edit scripts/data-classify/data/*.json and regenerate instead.'
    check: "git diff --cached --name-only | grep -E 'src/shared/data/(preference/preferenceSchemas|bootConfig/bootConfigSchemas)\\.ts|src/main/data/migration/v2/migrators/mappings/(Preferences|BootConfig)Mappings\\.ts'"

  - id: no-v1-fallbacks
    severity: blocking
    description: 'v1 data reaches v2 only through src/main/data/migration/v2/ migrators — no fallbacks, dual-writes, or guards for v1 save/read/loss'

  - id: no-new-toplevel-dirs
    severity: blocking
    description: "Each process root's top level is a closed set — route new code into an existing category, never a new top-level directory"

  - id: signed-and-signed-off-commits
    severity: blocking
    description: 'Every commit is cryptographically signed AND DCO signed off: git commit -S --signoff'
    check: "git cat-file commit HEAD | grep -q '^gpgsig' && git log -1 --format='%(trailers:key=Signed-off-by)' | grep -q ."
```

---

## Warning Constraints (acknowledge before archiving)

```yaml
constraints:
  - id: no-behavior-pinning-tests
    severity: warning
    description: 'A test whose only assertion records current behavior has zero value. Assert the contract: real input → promised outcome, plus failure and edge cases. Before writing a test, state the bug it would catch.'
    note: 'Manual review required'

  - id: scoped-tests-run
    severity: warning
    description: 'Tests covering the change were run via the per-project wrapper or `pnpm exec vitest run <file>` — never `pnpm test <path>`'
    note: 'See scoped_test_commands in project.json'

  - id: docs-gate
    severity: warning
    description: 'Docs/markdown edits pass the docs gate (links + structure + frontmatter + generated index)'
    command: 'source "$HOME/.nvm/nvm.sh" && nvm use 24.11.1 >/dev/null && pnpm docs:check'

  - id: conventional-commit-specific-scope
    severity: warning
    description: 'Conventional Commit with a specific kebab-case module scope (feat(archive-settings):, fix(model-discovery):) — never generic like `main`'

  - id: surgical-changes
    severity: warning
    description: 'Every changed line traces to the request. No refactoring adjacent code that is not broken; no improving nearby comments or formatting.'
    note: 'Manual review required'

  - id: no-stub-comments
    severity: warning
    description: 'No TODO/FIXME/STUB/HACK comments in committed code'
    check: "grep -rn 'TODO\\|FIXME\\|STUB\\|HACK' src/"

  - id: ui-uses-design-system
    severity: warning
    description: 'New UI components come from @cherrystudio/ui (packages/ui, Shadcn + Tailwind) and follow DESIGN.md'
    note: 'Manual review required'

  - id: lifecycle-service-registration
    severity: warning
    description: "Main services owning long-lived resources extend BaseService with @Injectable/@ServicePhase/@DependsOn, register in serviceRegistry.ts, and are reached via application.get('Name') — never `new`"
    note: 'Manual review required'

  - id: data-subsystem-choice
    severity: warning
    description: 'SQLite business data → DataApi; user setting → Preference; losable/shared → Cache; early boot → BootConfig; else imperative → IpcApi. No DB table means no DataApi endpoint.'
    note: 'Manual review required'
```

---

## Workflow Triggers

```yaml
workflow_triggers:
  - event: on_iteration_complete
    action:
      type: command
      target: 'source "$HOME/.nvm/nvm.sh" && nvm use 24.11.1 >/dev/null && pnpm lint'

  - event: on_change_complete
    action:
      type: command
      target: 'source "$HOME/.nvm/nvm.sh" && nvm use 24.11.1 >/dev/null && pnpm test'

  - event: on_refinement_complete
    action:
      type: command
      target: "git add -A && git commit -S --signoff -m 'kbd: refine <change-id>'"
```

---

## Path Ownership Exceptions

Explicit exceptions — do not treat these as disposable tool state:

- `.prometheus/` — **repository-tracked** session knowledge wiki (committed in
  `bfabce9`). Hidden and tool-generated, but deliberately under version control.
  Never delete, gitignore, or `git rm` it without an explicit instruction.
- `.claude/`, `.agents/` — tracked agent skill and command trees (110 tracked files).
- `openspec/` — tracked spec-driven workflow config.
- `CLAUDE.local.md` — gitignored, may be absent; when present it **overrides**
  `CLAUDE.md` wherever they conflict.
