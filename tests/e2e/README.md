# E2E Testing Guide

This directory contains end-to-end (E2E) tests for the Cherry Studio Electron application using Playwright.

## Critical-path regression

Cross-platform validation of development branches and release installers uses a separate
[regression workflow](regression/README.md), which reuses a controller-owned application
process through CDP. `pnpm test:e2e` runs the existing smoke suite described below;
`pnpm test:e2e:regression` runs the regression scenarios.

## Directory structure

```text
tests/e2e/
├── README.md                 # This guide
├── smoke/                    # Default Playwright suite
│   ├── globalSetup.ts
│   ├── globalTeardown.ts
│   ├── fixtures/
│   │   └── electron.fixture.ts
│   ├── utils/
│   │   ├── waitHelpers.ts
│   │   ├── uiLocator.ts
│   │   └── index.ts
│   ├── appLaunch.test.ts
│   └── composerFocus.test.ts
└── regression/               # Controller-owned critical-path suite
    ├── README.md
    ├── fixture.ts
    ├── RegressionApp.ts
    ├── setup.ts
    ├── 01-startup.test.ts
    └── ...
```

---

## Running tests

### Smoke suite

The prerequisites and commands below apply only to the smoke suite in `smoke/`.

#### Prerequisites

1. Install dependencies: `pnpm install`
2. Build the application: `pnpm build`

#### Commands

```bash
# Run the smoke suite
pnpm test:e2e

# Run with visible windows
pnpm test:e2e --headed

# Run a specific test file
pnpm playwright test tests/e2e/smoke/appLaunch.test.ts

# Run tests matching a name
pnpm playwright test -g "reasonable size"

# Run in debug mode (pauses execution and opens the debugger)
pnpm playwright test --debug

# Use Playwright UI mode
pnpm playwright test --ui

# View the test report
pnpm playwright show-report
```

### Critical-path regression suite

Use the [regression workflow](../../.github/workflows/e2e-regression-test.yml) for hosted macOS and Windows runs.
It prepares the application, isolated run directory, and provider configuration before running the scenarios.
`pnpm test:e2e:regression` selects the regression config, but does not perform that preparation itself:
execution requires `CHERRY_TEST_RUN_DIR` to point to an initialized controller run.
See the [scenario guide](regression/README.md) and [controller guide](../../scripts/e2e/regression/README.md)
for phase execution and configuration. Do not use the smoke suite's launch fixture for regression scenarios.

## Writing E2E tests

Test design and review follow the [Frontend Testing Guidelines](../../docs/references/testing/frontend-testing.md).

### Smoke suite

The smoke suite uses the following Electron E2E infrastructure:

- Import fixtures and assertions from `smoke/fixtures/electron.fixture.ts`: `test`, `expect`, `electronApp`, and `mainWindow`.
- Use `smoke/utils/uiLocator.ts` to locate stable application boundaries defined in the
  [UI Semantic Contract](../../docs/references/components/ui-semantic-contract.md).
- Refer to `playwright.config.ts` in the repository root for runtime settings.

### Critical-path regression suite

- Place numbered phase tests and domain helpers in `regression/`.
- Import `test` and `expect` from `regression/fixture.ts` in scenarios; use its `app` and `mainWindow` fixtures.
- Register cases in `scripts/e2e/regression/cases.ts` and follow the [scenario guide](regression/README.md).
- Use `playwright.regression.config.ts`, not the smoke suite's `playwright.config.ts`.

New E2E tests should verify complete user outcomes across processes using stable semantic locators and observable conditions.

---

## Configuration

The smoke suite is configured in `playwright.config.ts` in the repository root:

- `testDir`: Test directory (`./tests/e2e/smoke`)
- `timeout`: Test timeout (60 seconds)
- `workers`: Worker count (1; Electron tests run sequentially)
- `retries`: Retry count (2 in CI)

The regression suite uses [playwright.regression.config.ts](../../playwright.regression.config.ts):

- `testDir`: `./tests/e2e/regression`, matching `*.test.ts` files
- `workers`: 1 within each platform; the workflow runs macOS and Windows in parallel
- `retries`: 0
- Reports and failure evidence are written under `CHERRY_TEST_RUN_DIR`.

---

## Related documentation

- [Playwright documentation](https://playwright.dev/docs/intro)
- [Playwright Electron testing](https://playwright.dev/docs/api/class-electron)
