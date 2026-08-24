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
- `CHERRY_TEST_CHERRYIN_GEMINI_IMAGE_MODEL`
- `CHERRY_TEST_CHERRYIN_IMAGE2_MODEL`
- `CHERRY_TEST_CHERRYIN_ACCOUNT`
- `CHERRY_TEST_CHERRYIN_PASSWORD`

Chat and embedding providers are independent. Never print literal credentials,
write them to fixtures, attach them to Playwright artifacts, or pass them to an
unrelated action.

## Test organization

Each Playwright title starts with the manifest case ID and ends with one task
tag, for example:

```ts
test('[S-01] 应用启动冒烟测试 @startup-smoke', async ({ mainWindow }) => {
  // deterministic assertions
})
```

Keep `scripts/cherry-regression-test/cases.ts`, workflow task choices, and test
titles synchronized. Prefer accessible roles, labels, placeholders, test IDs,
and visible text. Native dialogs and cross-application interactions must use
the repository-owned helpers in `system-automation.ts`.

Record assertions in Playwright, not prose. The custom reporter writes case
status into `run.json`, saves failure screenshots, and feeds the Chinese
Markdown/JUnit reports. Do not enable Playwright Trace for credential-bearing
tests because action parameters can expose secrets. A passing result does not
depend on a model's judgment.

## Focused execution

With an initialized run directory and its owned Electron process running:

```bash
CHERRY_TEST_RUN_DIR=/absolute/run-directory \
CHERRY_TEST_PHASE=01-startup \
pnpm test:e2e:regression tests/e2e/cherry-regression/01-startup.test.ts
```

Run one task within a multi-case phase with its tag:

```bash
CHERRY_TEST_RUN_DIR=/absolute/run-directory \
CHERRY_TEST_PHASE=02-basic-features \
pnpm test:e2e:regression tests/e2e/cherry-regression/02-basic-features.test.ts \
  --grep '@notes'
```

Do not call the regression cleanup command for an Electron instance owned by
`cherry-electron-dev`; cleanup is only for an app record created by this driver.

## Verification when changing the framework

Run the focused script suite and enumerate Playwright cases:

```bash
pnpm test:scripts
CHERRY_TEST_RUN_DIR=/absolute/initialized/run-directory \
  pnpm test:e2e:regression --list
pnpm test:lint
```

Do not use `pnpm test` or `pnpm build:check` for this focused workflow change.
