# Critical-path desktop regression

These scenarios run against one controller-owned Electron instance per platform. The [controller](../../../scripts/cherry-regression-test/README.md) installs and launches either the requested development checkout or release installer.
The separate [Playwright config](../../../cherry-regression.playwright.config.ts) uses CDP rather than the per-test launch fixture used by the older E2E smoke suite.

## File organization

- Numbered `*.test.ts` files are the ten CI phases, ordered from startup to runtime tasks.
- `fixture.ts` validates required capabilities and owns each test's CDP connection and failure evidence.
- `RegressionApp.ts` locates windows and delegates process operations. Connecting or locating a window does not change application preferences.
- `setup.ts` explicitly establishes English locale, onboarding/telemetry settings, and disabled desktop assistants before each non-startup scenario.
- Domain helpers such as `models.ts`, `knowledge.ts`, and `agents.ts` express reusable user workflows.
- `CherryRegressionReporter.ts` maps native Playwright annotations/results into the controller's run state.

## State ownership

The application process and configured service providers are shared within a run. Provider configuration comes from the same run environment and is not changed between scenarios.
Custom assistants and knowledge bases are named with their case ID. Agent work directories are case-scoped; file tasks remove their own previous output before asserting newly produced content.
Each non-startup scenario begins on Chat with quick/selection assistants disabled. Persistence assertions restart the application inside the same scenario without repeating setup, so initialization cannot hide lost persisted state.
The built-in assistant's tests start new tasks and clear skill tokens where required. A scenario that mutates a shared resource must restore its intended state explicitly before relying on it.

A failed scenario must not supply the expected result for another scenario. Assert a new assistant response, a newly written file, or a real native event; do not inject success markers through IPC.

## Adding or selecting a case

1. Add the case to `scripts/cherry-regression-test/cases.ts`, including its phase, task, and required capabilities.
2. Register it with `test(...caseDefinition('CASE-ID'), async ({ app, mainWindow }) => { ... })`.
3. Establish its preconditions in the scenario or domain helper. Keep selectors scoped to the relevant product surface.
4. Run manifest tests, typechecking, and Playwright enumeration. Add a workflow step only when introducing a new phase.

Use the task IDs from the manifest in the workflow's `task` input (`all` selects every case). Within an initialized run, execute a phase through the same controller as CI:

```sh
pnpm exec tsx scripts/cherry-regression-test/cli.ts run-phase \
  --run-dir /absolute/run-directory --phase 02-basic-features
```

The run's task selection controls which cases execute. To run only Notes, initialize with `--task notes`; do not narrow an all-task run manually and then treat it as a full pass.

## Configuration and evidence

The repository variables/secrets are listed in `scripts/cherry-regression-test/config.ts`; the image model variable is `CHERRY_TEST_CHERRYIN_IMAGE_MODEL`.
Never attach credentials or enable credential-bearing Playwright traces. HTML reports and failure screenshots are produced by Playwright and the fixture; sanitized Electron logs are copied during finalization.

Use the [frontend testing guidelines](../../../docs/references/testing/frontend-testing.md). Keep local changes separate from hosted runtime validation; successful enumeration and unit tests do not prove desktop permissions or external model availability.
