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
| `debugBridge.ts`, `cdp-client.ts` | Explicit main-process debug operations and protocol callback delivery |
| `system-automation.ts` | Native dialogs, external text selection, and keyboard input |
| `state.ts`, `report.ts` | Run state, platform/aggregate verdicts, and human-readable reports |
| `fixtures.ts`, `paths.ts`, `config.ts` | Input fixtures, run-owned paths, and configuration |

Dependencies flow from CLI and E2E fixtures into these modules. The controller does not import E2E scenarios or production services.
The debug bridge may inspect the owned main process; it must never manufacture a successful product result.
The explicit profile/restart operation prepares Windows connections by closing non-main windows before CDP attaches; simply locating a window does not perform this preparation. Both branch and installer launches enable the main-process inspector for this explicit compatibility step.

## Execution contract

The workflow keeps ten separately timed steps. Each calls `run-phase`; the controller intersects its phase with the run's selected task and returns immediately for unselected phases.
`cases.ts` is the execution manifest. Workflow task input is a string validated against the manifest, so adding a task does not require another task list in YAML.

`run.json` schema version 2 records both cases and phases. The parent marks a phase running before starting Playwright; the reporter records test results and executor errors; a nonzero child exit also fails the phase.
A phase left pending/running becomes blocked during finalization. Passing cases cannot hide a failed or unfinished phase. Missing platform reports block the aggregate gate.
Only one phase writes a platform's run state at a time; keep `workers: 1` and sequential workflow steps.

Capability requirements belong to cases. Missing required capabilities skip execution with an explicit reason and are recorded as blocked, never passed.
Capability probes are preflight checks, not evidence that a product interaction succeeded.

## Verification

- `pnpm exec vitest run --project scripts scripts/cherry-regression-test`
- `pnpm typecheck:e2e`
- `CHERRY_TEST_RUN_DIR=/tmp/cherry-regression-list pnpm test:e2e:regression --list`
- `pnpm lint` and `pnpm docs:check`

Enumeration does not launch Electron or require an initialized run. Full desktop acceptance still requires both hosted platforms and the aggregate gate.
