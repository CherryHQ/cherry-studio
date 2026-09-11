---
name: cherry-regression-test
description: Run Cherry Studio critical-path system regression tasks through the repository-owned Playwright E2E workflow. Use for full regression, release acceptance, development-branch system validation, or a named cherry-regression-test task on GitHub-hosted macOS and Windows runners.
---

# Cherry Regression Test

Run deterministic Playwright E2E tests against one driver-owned Cherry Studio
process per platform. The tested product includes Chat, Agents, MCP, Skills,
knowledge bases, translation, image generation, and code tools; an LLM test
agent does not control the test run.

## CI contract

Use `.github/workflows/cherry-regression-test.yml` as the entry point. It:

1. Resolves a trusted branch or release tag.
2. Initializes an isolated directory under the GitHub runner temporary folder.
3. Installs the application and the code tools under test.
4. Launches one owned Electron process with CDP enabled.
5. Runs the ten files in `tests/e2e/cherry-regression/` from simple to complex.
6. Continues after a failed phase so later results are still collected.
7. Produces Chinese platform and aggregate reports, then enforces the verdict.
8. Stops only the Electron process recorded in the isolated run directory.

Do not add an LLM tool loop, MCP control server, turn limit, or a second
Electron launch for each test. A restart is allowed only where the case contract
explicitly verifies persistence or switches from the clean startup profile to
the authenticated shared profile.

## Configuration

The workflow reads these repository variables and secrets:

- `CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL`
- `CHERRY_TEST_CUSTOM_PROVIDER_API_KEY`
- `CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL`
- `CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_BASE_URL`
- `CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_API_KEY`
- `CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_MODEL`
- `CHERRY_TEST_CHERRYIN_CHAT_MODEL`
- `CHERRY_TEST_CHERRYIN_IMAGE_MODEL`
- `CHERRY_TEST_CHERRYIN_ACCOUNT`
- `CHERRY_TEST_CHERRYIN_PASSWORD`

Chat and embedding providers are independent. Never print literal credentials,
write them to fixtures, attach them to Playwright artifacts, or pass them to an
unrelated action.

## Test organization

Read [scenario organization](../../../tests/e2e/cherry-regression/README.md) and the
[controller contract](../../../scripts/cherry-regression-test/README.md) before making changes.

Register each case from the manifest:

```ts
test(...caseDefinition('S-01'), async ({ mainWindow }) => {
  // Assert the user-visible outcome.
})
```

`cases.ts` owns case IDs, titles, task tags, phases, and capability requirements.
The workflow accepts a task ID and delegates selection to the controller.
Prefer accessible roles, labels, placeholders, test IDs,
and visible text. Native dialogs and cross-application interactions must use
the repository-owned helpers in `system-automation.ts`.

Record assertions in Playwright, not prose. The custom reporter writes case and phase
status into `run.json` and feeds the Chinese Markdown/JUnit reports. The fixture
saves failure screenshots. Executor errors and interrupted phases block a passing verdict. Do not enable Playwright Trace for credential-bearing
tests because action parameters can expose secrets. A passing result does not
depend on a model's judgment.

## Focused execution

With an initialized run directory and its owned Electron process running:

```bash
pnpm exec tsx scripts/cherry-regression-test/cli.ts run-phase \
  --run-dir /absolute/run-directory --phase 02-basic-features
```

The task selected when initializing the run determines which cases execute.
For a Notes-only run, initialize with `--task notes`. Enumeration is read-only:

```bash
CHERRY_TEST_RUN_DIR=/tmp/cherry-regression-list pnpm test:e2e:regression --list
```

Do not call the regression cleanup command for an Electron instance owned by
`cherry-electron-dev`; cleanup is only for an app record created by this driver.

## Verification when changing the framework

Run the focused script suite and enumerate Playwright cases:

```bash
pnpm exec vitest run --project scripts scripts/cherry-regression-test
CHERRY_TEST_RUN_DIR=/absolute/initialized/run-directory \
  pnpm test:e2e:regression --list
pnpm typecheck:e2e
pnpm test:lint
```

Do not use `pnpm test` or `pnpm build:check` for this focused workflow change.
