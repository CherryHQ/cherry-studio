# Agent Note: CI and local validation performance

Status: proposed

English | [中文](2026-10-01-ci-and-local-validation.zh.md)

## Problem

CI and local coding agents spend time checking unrelated code, while their independently maintained task lists omit some package tests. Local commands also combine checks, source fixes, builds, and native module preparation. Multiple agents multiply that work and compete for the same machine.

The proposed direction is to share task definitions and change classification between local validation and CI, while giving each a different concurrency policy. First correct selection and coverage, then optimize heavy checks and caches. This note records research on 2026-10-01; no proposed commands or workflow changes have been implemented, and the existing agent instructions still apply.

## Evidence

### Scope and sampling

The source baseline is commit `3942cd2f700082745a80b94a78f3667db2d81887`, matching main when queried. Sources include [CI](../../../../.github/workflows/ci.yml), [root scripts](../../../../package.json), [Vitest projects](../../../../vitest.config.ts), [workspace configuration](../../../../pnpm-workspace.yaml), and [Git hooks](../../../../.pre-commit-config.yaml).

From the latest 100 CI runs retrieved during the investigation, the latest 30 successful runs were sampled. Their creation times span 2026-09-30 09:48:38–15:55:38 UTC, or 17:48:38–23:55:38 Asia/Shanghai. They comprise 20 pull request and 10 push runs. Job and step durations come from GitHub Actions timestamps for the latest attempt; failed, cancelled, and unfinished runs are excluded from these timing statistics. This is a same-day baseline, not a long-term benchmark or evidence of local performance.

| Measurement | Samples | Median |
| --- | --- | --- |
| Basic checks job execution | 30 | 363 s |
| Basic checks start delay from run creation | 30 | 3 s |
| I18N Translation Check | 30 | 123 s |
| Read-only Checks parallel group | 30 | 158 s |
| Basic checks dependency restore on PRs | 20 | 35.5 s |
| Basic checks dependency installation | 30 | 20.5 s |
| macOS test dependency restore | 24 | 140 s |
| macOS Main and Package Tests step | 24 | 45 s |

Basic checks were the last successful job to finish in 21 of 30 runs. Their duration ranged from 267 to 420 seconds. Step medians are separate distributions and must not be added as if they represented one run. The macOS test step includes native preparation, not only test execution.

The [backup PR basic job](https://github.com/CherryHQ/cherry-studio/actions/runs/36740345816/job/109972792418) provides a representative breakdown:

- I18n sync and validation together took about 2 seconds; unused-key analysis took about 121 seconds.
- The following lint branch took about 156 seconds: approximately 56 seconds for Oxlint and 100 seconds for ESLint.
- Type checking followed by hardcoded-string analysis took about 122 seconds, concurrently with lint. Docs checks took about 7 seconds.
- The restored Linux pnpm cache was approximately 2,342 MB. A cache hit still required transfer and extraction.

The [main push run](https://github.com/CherryHQ/cherry-studio/actions/runs/36740426367) and [workflow-only PR run](https://github.com/CherryHQ/cherry-studio/actions/runs/36700773347) also show the expensive global checks. Raw API responses and logs were saved under the investigating workspace's ignored `.context/ci-research/`; this note preserves the findings and public evidence without depending on those local artifacts.

### Why documentation still incurs expensive CI

`basic-checks` has no change classification dependency: every eligible non-draft PR runs its global checks. Test jobs do have path filters, but `src/main/**`, `src/renderer/**`, and package globs include colocated README files. Every push to a configured branch bypasses those filters through an unconditional push condition.

[PR 16462](https://github.com/CherryHQ/cherry-studio/pull/16462) changed nine Markdown files under `docs/`. At observation time, its [CI](https://github.com/CherryHQ/cherry-studio/actions/runs/36741982750) had skipped unit tests while basic checks were still running; this is not a recorded final result.

[PR 20990](https://github.com/CherryHQ/cherry-studio/pull/20990) changed two bundled skill Markdown files. Its [PR run](https://github.com/CherryHQ/cherry-studio/actions/runs/35910375405) skipped tests, whereas its [post-merge push](https://github.com/CherryHQ/cherry-studio/actions/runs/35957469812) ran all ten test shards. Bundled skills are runtime resources, so this example demonstrates event-dependent selection, not that all its tests can safely be removed.

### Basic checks are serialized around global scans

[Unused-key analysis](../../../../scripts/i18n-check-unused.ts) parses renderer, main, shared, and package sources with ts-morph. Main sources participate in both renderer-catalog analysis and a separate main-catalog pass. CI waits for this entire step before starting the parallel lint/type/docs group.

Within that group, typecheck projects are explicitly serialized because running ESLint with multiple typecheck processes previously caused runner OOM. Simply removing that limit is not a supported optimization. ESLint uses `--cache`, but the workflow persists the pnpm store, not the ESLint result cache.

### Test coverage differs across entry points

| Task or package | Observed coverage gap |
| --- | --- |
| Root `test` | Includes UI and preload, but does not enumerate remote package tests |
| Root `ci:test-check` | Includes remote packages, but omits the UI and preload project commands |
| Main CI and remote packages | No remote-protocol or remote-transport filters or root Vitest projects; their standalone tests run separately in the [package release workflow](../../../../.github/workflows/release-packages.yml) |
| dsh-bridge | Has standalone tests but no corresponding main CI filter/project |
| ai-sdk-provider | Its changes trigger aiCore/main/renderer, but the aiCore project only collects `packages/aiCore/**`; provider-owned tests are not selected |

These are test-discovery and orchestration gaps, not proof that consumers have no integration coverage. A successful build is not equivalent to running the package's tests.

### Local command contracts amplify concurrent work

The root package contains 105 scripts, including 18 platform/architecture/edition build aliases. The count is a maintenance signal; the following behavior is the performance concern:

| Entry point | Current behavior and consequence |
| --- | --- |
| `lint` | Fixes the whole repository, runs all type checks and i18n validation, then formats the whole repository. A small change invokes broad checks and may modify unrelated files. |
| `typecheck` | Builds ai-sdk-provider, then launches node, web, aiCore, and e2e checks concurrently. The build has `clean: true` and rewrites `dist`. |
| Vitest | `maxWorkers: '50%'` applies to each invocation, not to all agents together. Several worktrees can each request half the machine's available parallelism. |
| `test` | Chains three Vitest invocations. Appending a file argument does not scope the earlier invocations. |
| `test:scripts` | Uses `vitest scripts`, a path filter rather than an explicit project and run mode; interactive execution may enter watch mode. |
| `postinstall` | Builds dsh-bridge and both remote packages; dependency setup is also build preparation. Checkout/merge hooks can invoke installation. |
| `dev` and main tests | Prepare different better-sqlite3 ABIs in one binary slot. They are not independent tasks within the same worktree. |

Different worktrees primarily compete for CPU, memory, and I/O. Concurrent commands in one worktree additionally share mutable build output, caches, and native binaries. No local multi-agent load benchmark or collision reproduction was performed; the contention mechanism is a hypothesis supported by command structure, not a quantified local slowdown.

Node and web tsconfigs already enable incremental compilation and use distinct `.tsbuildinfo` files. Recommending incremental compilation as a missing feature would be incorrect. The [binary downloader](../../../../scripts/download-binaries.js) already has a shared versioned cache, so repeated downloads must be measured rather than assumed. See the [native ABI contract](../../../../docs/references/testing/database-testing.md#better-sqlite3-native-module-abi).

## Proposal

### Shared task definitions with separate execution policies

Define each check, test project, and necessary preparation task once. Local commands and CI should consume the same coverage rules. Keep `package.json` as a readable entry surface and use existing pnpm/Vitest capabilities before introducing orchestration code. Do not migrate application directories into new packages just to obtain a task graph.

The following interfaces are proposals, not available commands:

| Layer | Candidate interfaces | Contract |
| --- | --- | --- |
| Individual tasks | `lint:check`, `lint:fix`, `format:check`, `format:write`, `typecheck:node`, `test:renderer` | One purpose, explicit scope, predictable argument forwarding; source checks do not fix source files |
| Daily local validation | `check`, `check --plan` | Select affected tasks and explain why; use bounded concurrency |
| Complete validation | `check:all`, CI scheduling | Reuse the task definitions for all checks or selected CI jobs and shards |

Source checks may update disposable caches; preparation that cleans or writes package output must remain an explicit dependency. Verify why provider generation is needed before removing it. Establish one authoritative test inventory, including standalone packages, and ensure every eligible test belongs to an execution path.

Update AGENTS.md and developer guidance with the new entry points in the same implementation. Their current requirement to run broad `pnpm lint` would otherwise keep agents on the expensive path. Preserve or deliberately migrate existing public script names and CI consumers instead of silently changing their meaning.

### Change classification

| Changed input | Proposed checks |
| --- | --- |
| Ordinary docs and colocated README files | Formatting and docs validation |
| Development skill files | Formatting, skill consistency, applicable docs checks |
| Bundled prompts, skills, and runtime resources | Relevant generation and resource-contract checks/tests |
| Renderer code | Relevant lint/i18n, web types, renderer tests |
| Main or preload code | Relevant lint/i18n, node types, main/preload tests and any renderer consumer checks |
| Shared code or public packages | Own checks/tests and affected consumers |
| Global dependencies, configurations, or test infrastructure | All affected projects, conservatively broad |
| Unknown code/resource paths | Visible conservative fallback and a request to extend the classification |

Local selection must include branch changes, staged and unstaged edits, untracked files, deletions, and renames. PR selection uses the full PR delta; push selection uses the pushed range. A docs-only final commit must not hide earlier code changes in that range. Missing comparison history or classification errors must not produce an empty successful plan.

Do not exclude all Markdown: runtime prompts and fixture documents are meaningful inputs. Docs checks are inexpensive and should also cover deletions or moves that can invalidate links and frontmatter `sources`.

Keep cross-process dependency edges explicit, including preload declarations and shared contracts. Type checking should select complete affected projects, not pass a few changed files to `tsc` and bypass project configuration. Unused-i18n validation must respond to source-reference changes as well as locale changes. Database and generator checks must include both their inputs and committed outputs.

### Local concurrency and preparation

Start measurement with one heavy task at a time and a small fixed test-worker budget per local invocation. Treat those limits as candidate settings until benchmarked. Bound both outer task concurrency and inner workers; an outer limit alone does not constrain Vitest or compiler work.

Reuse preparation once per plan. Keep caches and mutable output worktree-local unless cross-worktree sharing has an explicit immutable key and safe publication contract. Do not deduplicate validation results merely by HEAD: agents may have different uncommitted inputs. Avoid concurrent Electron/Node ABI preparation against the same installation.

Measure cold and warm typecheck caches, provider build requirements, and installation side effects before changing them. Consolidating release aliases is lower priority than fixing frequently used validation commands.

### CI scheduling and gates

Give ordinary documentation a lightweight path on PRs and pushes. Split heavy lint, typecheck, and i18n work into independently schedulable jobs; evaluate their extra checkout/install overhead before finalizing the grouping. Keep inexpensive formatting/docs/generator checks grouped where practical.

Retain the current Linux main and renderer shard counts as an initial baseline. More shards duplicate large cache restores and installations; platform jobs already spend substantial time preparing dependencies. Select macOS/Windows work from platform-sensitive modules and their dependencies, not only changed files containing `process.platform`. Preserve the native-safe main test pool.

Cancel superseded PR runs, with concurrency scoped by workflow and PR. Do not extend cancellation automatically to release/publication workflows. Retain manual full validation and add scheduled full validation as a backstop; neither replaces required checks for affected changes.

At research time, the [main rules endpoint](https://api.github.com/repos/CherryHQ/cherry-studio/rules/branches/main) required `basic-checks`, `general-test`, and `render-test`. Preserve these names as aggregation gates unless their consumers are explicitly migrated. Gates must validate the planned task results and reject failed classification, failed/cancelled required work, and unexplained skips. A declared empty plan can pass; missing evidence cannot.

### Further optimization candidates

After selection and coverage are correct, measure ESLint result caching and file-content caching for i18n parsing. Cache invalidation must include tool versions, configuration, and relevant dependencies. Hardcoded-string checks may support changed-file execution; global unused-key checks still need a complete reference set.

Pilot Vitest related-test selection only where its dependency model is sufficient. Dynamic imports and filesystem-loaded resources require explicit inputs. Defer any claimed time saving until comparisons use equivalent coverage.

## Implementation plan

Implementation through stacked PRs was authorized on 2026-10-01. Three layers follow dependency order:

1. Test inventory: register missing standalone packages in root Vitest, unify complete test entry points, and use explicit run mode.
2. Local validation: share task/classification rules; implement `check`, `check --plan`, and `check:all`; separate lint checks from fixes; default to sequential heavy tasks and two local test workers; update developer instructions.
3. CI scheduling: consume the same classification, separate repository/lint/types/i18n work, select test projects, retain the three required aggregation checks, and cancel superseded PR runs.

Keep old aggregate commands as compatibility entries without separate task lists. Initially, code lint remains conservative and repository-wide; typecheck selects complete projects; inexpensive format/docs checks remain repository-wide. Caching, file-level lint/related-test selection, and finer platform selection await equivalent-coverage measurements; no speedup is promised in this implementation. Validate and commit each layer independently; upper PRs target their immediate predecessor and the bottom PR targets main.

## Alternatives considered

- **Top-level workflow `paths-ignore`.** Reject for required workflows: GitHub can leave required checks pending when the workflow is skipped. Prefer explicit plans and aggregation gates.
- **Exclude every Markdown file.** Reject because bundled skills, prompts, and fixtures affect runtime behavior.
- **More jobs, shards, or unrestricted parallelism everywhere.** Reject as the default: setup cost, local contention, and the previous CI memory limit need measurement.
- **Use only `vitest related` or package filters.** Insufficient for dynamic/filesystem inputs and the main/renderer/shared domains inside the root package. Use supported built-ins within their boundaries.
- **Introduce Nx, Turborepo, or a machine-wide agent scheduler immediately.** Defer. First establish task contracts and measure existing pnpm/Vitest controls; a new framework does not automatically fix dependency declarations or omitted tests.
- **Rename scripts or move shell chains into one large script only.** Insufficient: duplicated coverage, hidden writes, and resource ownership would remain.
- **Maintain separate local and CI task inventories.** Reject because they have already drifted. Different execution policies should share coverage definitions.

## Acceptance criteria

| Phase | Work | Verification |
| --- | --- | --- |
| 1 | Shared inventory, change classification, docs path, missing package tests, superseded PR cancellation | Replay representative historical file sets; prove each package's tests are selected and gates remain valid |
| 2 | Explicit local command contracts and bounded execution | File arguments reach only the intended project; check mode leaves tracked sources unchanged; instructions match actual commands |
| 3 | Independent heavy CI checks and preparation reuse | Compare equivalent CI runs for end-to-end duration, runner minutes, setup time, and failures |
| 4 | Cache and finer dependency selection | Verify cold/warm invalidation, deletions/renames, resource changes, and no stale-success reuse |

Selection fixtures must cover ordinary docs, colocated README, runtime Markdown, main-only, renderer-only, shared, each standalone package, preload contracts, locales, migrations, scripts, root dependencies/configuration, unknown paths, mixed changes, deletion, rename, untracked input, and unavailable git history. Planned-job failure/cancellation must fail the gate; intentional no-op selection must be visible.

Local benchmarks should compare one, two, and four independent worktrees with cold and warm caches and representative small changes. Record per-task and all-agents completion time, worker/process counts, peak memory and memory pressure, CPU utilization, setup time, and incidental writes. Shared-machine measurements must run in a controlled window; no such load test was performed during this investigation. Choose defaults from measured throughput and responsiveness, not a promised percentage improvement.

## Risks

Overly narrow dependency mappings can miss regressions. Cross-file lint rules and global i18n references limit naive diff-only execution. Separate jobs can shorten elapsed time while increasing runner minutes. Cache keys can preserve stale success; shared writable outputs can create races. Renaming scripts can break hooks, skills, or external users. A scheduled green run does not prove a later PR or packaged runtime is valid.

This proposal requires implementation review and measurement. The implementation authorization above covers validation tooling and CI; package-boundary changes, toolchain replacements, and caching experiments remain outside this stack.

## References

- [pnpm filtering](https://pnpm.io/filtering) and [recursive execution](https://pnpm.io/cli/recursive): package/dependency selection and concurrency. Validate semantics against the repository's pinned pnpm 12.6.0; current documentation also describes newer versions.
- [Vitest related tests](https://vitest.dev/guide/cli.html#vitest-related) and [worker limits](https://vitest.dev/config/maxworkers): static dependency boundaries and per-invocation worker controls.
- [TypeScript incremental compilation](https://www.typescriptlang.org/tsconfig/incremental.html): existing project-cache behavior.
- [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax): filtering, concurrency, and skipped required workflows.
- [Docs governance proposal](2026-08-18-docs-governance-and-spec-workflow.md): ownership of this proposed Agent Note and the distinction between workflow execution and local script aliases.
