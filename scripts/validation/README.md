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

`--group repository|lint|types|i18n|main|renderer|packages|platform|checks|tests` restricts an
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

## CI

PRs compare the checked-out merge commit with its first parent, so earlier commits
remain covered. Pushes compare the event's before/after range. A daily schedule and
manual dispatch run the full plan. PR concurrency cancels superseded runs; pushes
are not cancelled. Pull requests targeting a parent stack branch also run CI.

Repository and typecheck groups share one dependency installation in `validation-checks`,
with separate plan conditions and step outcomes. Lint and i18n remain independent. Main/preload retain
three Linux shards; renderer retains five. Selected package tests run once in their
own job. macOS/Windows retain the platform-gated test inventory; platform selection is deliberately conservative whenever main is selected.

The required `basic-checks`, `general-test`, and `render-test` names remain stable.
Their verifier requires classification to succeed, checks every planned job, and
accepts a skipped dependency only when the plan explicitly excludes it. The basic
gate also checks both group outcomes from the shared job, rejecting missing or
unexpectedly skipped work even if that job reports success. Schema drift,
provider generation, changeset policy, and catalog edit guards remain CI checks.

## Performance observations

`CI Performance` runs after CI completes and reads job/step timestamps through the
GitHub API. It checks out only the default branch, never the measured PR's code, and
needs no dependency installation. The observer becomes active after its workflow and
scripts reach the default branch. It has read-only permissions and is not a required
check; collection failures do not fail the CI gate.

The summary and 30-day JSON artifact distinguish initial queue time, execution wall
time, total elapsed time, and the sum of job durations. The latter is runner time,
not billed minutes; initial queue time does not include later dependency/runner waits.
Queue and total elapsed are omitted for reruns because their creation time belongs to
the original attempt. The JSON preserves individual step durations for installation/cache analysis.

Baseline P50/P90 values use matching successful runs from the latest 20 successful
runs of the same CI workflow/event, before the measured run. Comparisons require the
same task/project scope hash, executed jobs, runner labels, and known cache states.
Exact dependency-store hits are marked; misses, fallback restores, or missing cache
instrumentation remain unknown and are excluded from baselines. Cache state here
refers only to the pnpm store, not to every build/runtime cache. Old workflows without
scope metadata are reported without comparison. Failed/cancelled runs never become
baseline samples. The report shows sample size and applies no regression threshold.

This observes ordinary CI work without rerunning tests. Controlled repeated benchmarks
and local 1/2/4-worktree contention tests remain separate from this observer.

## Queue and dependency preparation follow-up

Sharing repository and typecheck setup removes one Ubuntu job when both groups are
selected: a full healthy CI workflow run goes from 19 runners (17 Ubuntu) to 18
(16 Ubuntu). The separate performance observer is excluded from those counts.
The PR description workflow also shares its
synchronize reminder with description validation, reducing that event from two
Ubuntu jobs to one and cancelling superseded runs for the same PR.

In [run 38523296197, type-checks](https://github.com/CherryHQ/cherry-studio/actions/runs/38523296197/job/115719283049),
an exact pnpm store hit restored about 2383 MB in 64 seconds, installation took
18 seconds, and typechecking took 19 seconds. Removing one repeated setup therefore
avoids roughly 82 seconds of aggregate runner preparation at that sample's cost.
This is a static estimate, not a measured wall-time speedup: the groups now run in
sequence, and hosted queueing plus workload variation still affect completion time.

The store cache and frozen-lockfile install remain unchanged. Before narrowing the
cache, inventory its files and sizes on Linux/macOS/Windows, separate immutable
package content from native side effects, and benchmark exact-hit, fallback and cold
installs with unchanged plans. Verify native builds and selected checks on every
platform before changing cache paths or keys. A store-path glob without that evidence
could discard required indexes or native artifacts; filtered dependency installation
would require a separate dependency-boundary change.
