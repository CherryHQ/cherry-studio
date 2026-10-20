# Critical-path desktop regression

These scenarios run against one controller-owned Electron instance per platform. The [controller](../../../scripts/e2e/regression/README.md) installs and launches either the requested development checkout or release installer.
The separate [Playwright config](../../../playwright.regression.config.ts) uses CDP rather than the per-test launch fixture used by the older E2E smoke suite.

## File organization

- Numbered `*.test.ts` files are the ten CI phases, ordered from startup to runtime tasks.
- `fixture.ts` validates required capabilities and owns each test's CDP connection and failure evidence.
- `RegressionApp.ts` locates windows and delegates process operations. Connecting or locating a window does not change application preferences.
- `setup.ts` explicitly establishes English locale, onboarding/telemetry settings, and disabled desktop assistants before each non-startup scenario.
- Domain helpers such as `models.ts`, `knowledge.ts`, and `agents.ts` express reusable user workflows.
- `navigation.ts` and `settings.ts` own shared navigation; `chat.ts` owns chat interactions and response assertions.
- The controller owns `RegressionReporter.ts` and its unit tests.
- Helpers import Playwright assertions directly; only scenarios import the extended `test` from `fixture.ts`.

## State ownership

The application process and configured service providers are shared within a run. Provider configuration comes from the same run environment and is not changed between scenarios.
Custom assistants and knowledge bases are named with their case ID. Agent work directories are case-scoped; file tasks remove their own previous output before asserting newly produced content.
Each non-startup scenario begins on Chat with quick/selection assistants disabled. Persistence assertions restart the application inside the same scenario without repeating setup, so initialization cannot hide lost persisted state.
The built-in assistant's tests start new tasks and clear skill tokens where required. A scenario that mutates a shared resource must restore its intended state explicitly before relying on it.

A failed scenario must not supply the expected result for another scenario. Assert a new assistant response, a newly written file, or a real native event; do not inject success markers through IPC.

The `knowledge` task is one end-to-end case (`K-01`): create and index a knowledge
base, verify recall, restart the application, then query the persisted base and
verify the answer and citations. It imports the fixtures only once. The former
`knowledge-import` and `knowledge-qa` task IDs are replaced by `knowledge`.

## Adding or selecting a case

1. Add the case to `scripts/e2e/regression/cases.ts`, including its phase, task, and required capabilities.
2. Register it with `test(...caseDefinition('CASE-ID'), async ({ app, mainWindow }) => { ... })`.
3. Establish its preconditions in the scenario or domain helper. Keep selectors scoped to the relevant product surface.
4. Run manifest tests, typechecking, and Playwright enumeration. Add a workflow step only when introducing a new phase.

Use the task IDs from the manifest in the workflow's `task` input (`all` selects every case). Within an initialized run, execute a phase through the same controller as CI:

```sh
pnpm exec tsx scripts/e2e/regression/cli.ts run-phase \
  --run-dir /absolute/run-directory --phase 02-basic-features
```

The run's task selection controls which cases execute. To run only Notes, initialize with `--task notes`; do not narrow an all-task run manually and then treat it as a full pass.

## Local streaming failure regression

`chat-stream-failure` (`C-03`, phase `03-models-and-assistants`) needs no external
provider credentials. It uses the [shared mock chat HTTP server](../../helpers/http/README.md),
seeds a case-owned provider and assistant through DataApi, and sends a message in
the real UI. After partial text becomes visible, it destroys the HTTP connection
without a finish chunk. The case checks that the text remains visible, the stored
message has status `error` with text state `done`, and the same message survives
an Electron restart. A follow-up message must then complete successfully. The case
restores topic naming and removes its test resources.

Run from the repository root, with CDP port 9222 and inspector port 9229 free:

```sh
pnpm install
pnpm rebuild:electron
pnpm run build:utility-process
TEST_RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cherry-stream-failure.XXXXXX")"
pnpm exec tsx scripts/e2e/regression/cli.ts preflight --task chat-stream-failure
pnpm exec tsx scripts/e2e/regression/cli.ts initialize \
  --run-dir "$TEST_RUN_DIR" --mode branch --platform macos \
  --task chat-stream-failure --ref "$(git branch --show-current)" \
  --sha "$(git rev-parse HEAD)" --runner local
pnpm exec tsx scripts/e2e/regression/cli.ts launch \
  --run-dir "$TEST_RUN_DIR" --target-root "$PWD" --run-key "$(basename "$TEST_RUN_DIR")"
pnpm exec tsx scripts/e2e/regression/cli.ts run-phase \
  --run-dir "$TEST_RUN_DIR" --phase 03-models-and-assistants
pnpm exec tsx scripts/e2e/regression/cli.ts finalize --run-dir "$TEST_RUN_DIR"
pnpm exec tsx scripts/e2e/regression/cli.ts gate --run-dir "$TEST_RUN_DIR"
pnpm exec tsx scripts/e2e/regression/cli.ts cleanup --run-dir "$TEST_RUN_DIR"
```

Always run `cleanup`, including after a failure. The controller stops only its
recorded process. The run directory contains the report and failure evidence;
boot configuration and application data are isolated under the run directory. Keep
local runs outside the source checkout so generated extension code is not scanned
by repository lint. Do not run Node SQLite tests
while Electron is running, since native dependency rebuilds switch its ABI.

## Configuration and evidence

The repository variables/secrets are listed in `scripts/e2e/regression/config.ts`; the image model variable is `CHERRY_TEST_CHERRYIN_IMAGE_MODEL`.

Custom chat provider creation fills two required endpoint URLs:

- OpenAI: `CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL` (for example, `https://api.siliconflow.cn/v1`).
- Anthropic: `CHERRY_TEST_CUSTOM_PROVIDER_ANTHROPIC_BASE_URL` (for example, `https://api.siliconflow.cn`).

Both endpoints use `CHERRY_TEST_CUSTOM_PROVIDER_API_KEY`. The embedding provider remains separately configured.

Never attach credentials or enable credential-bearing Playwright traces. HTML reports and failure screenshots are produced by Playwright and the fixture; sanitized Electron logs are copied during finalization.

Use the [frontend testing guidelines](../../../docs/references/testing/frontend-testing.md). Keep local changes separate from hosted runtime validation; successful enumeration and unit tests do not prove desktop permissions or external model availability.
