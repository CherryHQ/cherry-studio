# Regression controller

This directory owns the CI controller for the [Playwright regression scenarios](../../tests/e2e/cherry-regression/README.md).
It controls only the application recorded in its isolated run directory; it never discovers or stops a developer's Electron instance.

## Responsibilities

| Module | Responsibility |
| --- | --- |
| `cases.ts` | Case IDs, titles, task tags, phases, required capabilities, and selection |
| `cli.ts`, `phases.ts` | CLI entry points and one Playwright invocation per selected phase |
| `installation.ts`, `artifacts.ts` | Release installation, asset selection, and hashing |
| `lifecycle.ts` | Start, reuse, restart, and stop the owned application |
| `process.ts` | OS process identity, ancestry, ports, and termination |
| `debugBridge.ts`, `cdpClient.ts` | Explicit main-process debug operations and protocol callback delivery |
| `systemAutomation.ts` | Native dialogs, external text selection, and keyboard input |
| `CherryRegressionReporter.ts` | Playwright result adapter and run-state updates |
| `state.ts`, `report.ts` | Run state, platform/aggregate verdicts, and human-readable reports |
| `fixtureFiles.ts`, `paths.ts`, `config.ts` | Input fixtures, run-owned paths, and configuration |

Dependencies flow from CLI and E2E fixtures into these modules. The controller does not import E2E scenarios or production services.
The debug bridge may inspect the owned main process; it must never manufacture a successful product result.
The explicit profile/restart operation prepares Windows connections by closing non-main windows before CDP attaches; simply locating a window does not perform this preparation. Both branch and installer launches enable the main-process inspector for this explicit compatibility step.

## Execution contract

Branch runs prepare `rebuild:electron` and `build:utility-process` once after installing
application dependencies. The controller then launches the development server directly,
including on profile switches and persistence-test restarts. Local controller runs must
perform the same preparation in the target checkout before `launch`; release installers
do not need it. Restarting still stops the owned application and preserves its profile.

The workflow keeps ten separately timed steps. Each calls `run-phase`; the controller intersects its phase with the run's selected task and returns immediately for unselected phases.
`cases.ts` is the execution manifest. Workflow task input is a string validated against the manifest, so adding a task does not require another task list in YAML.

`run.json` schema version 2 records both cases and phases. The parent marks a phase running before starting Playwright; the reporter records test results and executor errors; a nonzero child exit also fails the phase.
A phase left pending/running becomes blocked during finalization. Passing cases cannot hide a failed or unfinished phase. Missing platform reports block the aggregate gate.
Only one phase writes a platform's run state at a time; keep `workers: 1` and sequential workflow steps.
The macOS and Windows jobs run in parallel; each platform keeps its own isolated run directory.
Test names and generated report text use English. External errors and captured application content remain unchanged.

Capability requirements belong to cases. Missing required capabilities skip execution with an explicit reason and are recorded as blocked, never passed.
Capability probes are preflight checks, not evidence that a product interaction succeeded.

## Combined report

The aggregate job publishes `test-report`. Download and extract
it, then open `index.html` to browse every platform and phase in one HTML
report, including failures and attachments. The same artifact contains
`summary.md`. Only the aggregate job writes GitHub's summary: platform
counts, actionable case/phase issues, and a cross-platform case table. Full
platform reports, logs, fixtures, and generated files are bundled under
`evidence/macos` and `evidence/windows` without duplication in the summary.
After the complete bundle is uploaded, the aggregate job deletes only this run's
temporary `test-evidence-macos` and `test-evidence-windows` artifacts. If download,
assembly, or upload fails, temporary artifacts are retained for diagnosis.
When the platform jobs succeeded, an aggregate-only rerun can recover missing
temporary artifacts from the previous bundle. Failed platform jobs never fall
back to old evidence. Rerunning a job replaces its same-named artifact.

Each phase retains a blob report with a platform/phase-specific filename. The aggregate
job uses Playwright's built-in `merge-reports` with an explicit test root for cross-OS
paths. Bundled platform evidence retains raw logs and generated files. The JSON
aggregate verdict remains authoritative, including missing or interrupted phases.

## Verification

- `pnpm exec vitest run --project scripts scripts/cherry-regression-test`
- `pnpm typecheck:e2e`
- `CHERRY_TEST_RUN_DIR=/tmp/cherry-regression-list pnpm test:e2e:regression --list`
- `pnpm lint` and `pnpm docs:check`

Enumeration does not launch Electron or require an initialized run. Full desktop acceptance still requires both hosted platforms and the aggregate gate.
