# Validation tooling

`pnpm check --plan` explains the checks and Vitest projects selected by `plan.mjs`.
`pnpm check` executes that plan serially; `pnpm check:all` runs the full gate.
`lint` only checks lint rules, `lint:fix` applies lint fixes, and `format` formats files.

## Change selection

The default comparison is the merge base of `origin/main` and HEAD, plus staged,
unstaged, and untracked files. `--base <parent>` supports stacked branches.
`--committed --base <commit> --head <commit>` compares exact commits for CI;
renames include both old and new paths. Missing history falls back to full validation.

Ordinary Markdown under docs, agent notes, and changesets, root Markdown, and source
READMEs select format and documentation checks. Runtime Markdown under resources
retains full checks. Skill files select the skill gate as well. Unknown inputs,
root configuration, workflow changes, and the planner itself select all tasks.

Source changes select their project and known consumers. Shared changes select all
projects. Source changes retain full lint and i18n scans because imports and translation
references cross file boundaries. This first implementation selects whole projects;
it does not claim that file-level affected tests cover runtime dependencies.

## Execution

`--group repository|lint|types|i18n|main|renderer|packages|checks|tests` restricts an
existing plan. `--shard=N/M` forwards Vitest's built-in sharding option. `--plan --json`
prints a machine-readable plan. Test commands are one Vitest invocation with explicit
projects; compilers run serially. Local Vitest defaults to two workers, overridable
through the direct Vitest command or project wrappers' `--maxWorkers` option.

Required workspace packages are built before typechecks and tests; main tests rebuild
SQLite for Node. Do not run Electron development and Node tests concurrently in one
worktree. Use isolated worktrees and dependency installations for concurrent agents.

`VALIDATION_PLAN` lets CI execute the exact plan from its classification job.
`--github-output` emits that plan and selected job groups without installing dependencies.
Unknown tasks or groups fail before execution. Summary validation rejects failed,
cancelled, missing, or unexpectedly skipped jobs selected by the plan.
