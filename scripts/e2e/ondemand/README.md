# On-demand desktop QA

`.github/workflows/qa-ondemand.yml` runs one JSON plan or reviewed scenario on one hosted Windows/macOS runner. It reuses the [regression controller](../regression/README.md) for ref resolution, release installation, and owned-process lifecycle; it does not run regression phases.

## Dispatch

Use `--ref main` to select the controller and `-f ref=...` to select the application. The workflow pins and reports both SHAs. The workflow must first exist on the default branch before GitHub accepts a dispatch; `--ref` cannot bypass first-time registration. After that initial merge, selecting a development branch explicitly tests its controller version.

```sh
gh workflow run qa-ondemand.yml --repo CherryHQ/cherry-studio --ref main \
  -f platform=windows -f mode=branch -f ref=main -f spec=smoke

gh workflow run qa-ondemand.yml --repo CherryHQ/cherry-studio --ref main \
  -f platform=macos -f mode=tag -f ref=v2.1.7 -f spec=smoke

gh workflow run qa-ondemand.yml --repo CherryHQ/cherry-studio --ref main \
  -f platform=windows -f mode=branch -f ref=main -f spec=provider-setup \
  -f plan="$(cat tests/e2e/ondemand/plans/example.json)"

gh workflow run qa-ondemand.yml --repo CherryHQ/cherry-studio --ref main \
  -f platform=windows -f mode=branch -f ref=main -f profile=authenticated -f spec=smoke
```

With a plan, `spec` is only the report name and needs no matching file. Without a plan, `smoke` uses the bundled JSON; other names require a reviewed code scenario. Names must match `^[a-z0-9][a-z0-9-]{0,40}$`. The plan's **10,240 UTF-8 byte** limit is a tool policy, separate from GitHub's dispatch payload limit. Use a reviewed scenario for longer flows. `timeout_minutes` defaults to 45; branch runs require 15–360 minutes, tag runs 1–360. Branch dependencies and Electron preparation can take several minutes before the test starts.

The platform/spec concurrency group queues requests with `queue: max` and never cancels an active request; it does not deduplicate plans. Linux is tracked in [#22055](https://github.com/CherryHQ/cherry-studio/issues/22055): three consecutive running days of green Windows branch/main and tag smoke, at least six successful runs with complete evidence. Count dispatch dates in Asia/Shanghai, skip dates without runs, do not skip incomplete running days, and reset on related failure/cancellation. Controller SHA changes alone do not reset the evidence.

## Plans and environment

A strict JSON object contains nonempty `steps`, optional `continueOnFailure` (default false), and optional `requiredTimezone` (IANA identifier). Unknown fields and verbs are errors. Available verbs and parameters:

| Verb | Parameters |
|---|---|
| `click` | `text` (exact visible text) |
| `clickRole` | `role`, `name` (exact accessible name) |
| `fill` | `selector`, `text` |
| `key` | `key` |
| `waitFor` | `selector`, optional `timeout` in milliseconds |
| `expectText` | `text`, optional `timeout` |
| `expectVisible` | `selector`, optional `timeout` |
| `screenshot` | optional `name` (same safe-name grammar as spec) |
| `sleep` | optional `ms`, default 1,000 |

Selectors must identify a single element for actions and `waitFor`. `expectVisible` and `expectText` check the first matching element; a hidden first match fails even if a later match is visible. `clickRole` accepts the roles enumerated in `plan.ts`. Actions/assertions default to 15 seconds; startup has a separate 120-second budget in both branch and tag modes. Branch mode starts a development server, so startup includes building and loading the application. Default execution stops at the first failure and marks remaining steps `not_run`. `continueOnFailure: true` collects more assertion failures, but never turns a failed/incomplete run into a pass; lost application connections still stop execution.

The controller enforces zh-CN through Electron and Preference, reloads, and verifies a visible Chinese UI marker: an onboarding combobox named `语言` or the shell button named `启动台`. These accessible names depend on the application's `common.language` and `title.launchpad` translations; changes to those translations require updating the controller's markers. The language control works across all onboarding steps. A structural `data-ui` selector alone cannot establish that Chinese translations are displayed. Environment inspection is fixed controller code; plans cannot supply JavaScript, shell commands, or IPC routes. A release lacking the required interfaces fails explicitly.

Hosted jobs set `TZ=Asia/Shanghai` for the controller and inherited application environment without changing the runner's operating-system settings. The controller defaults an unset `TZ` to `Asia/Shanghai` before creating its report or launching the application, including when Git Bash drops it on Windows. An explicitly supplied timezone is preserved. Actual main-process and renderer timezones are still recorded. Ordinary plans do not fail because of timezone differences. `requiredTimezone` makes matching application main-process and renderer timezones mandatory; it verifies a dependency rather than selecting a timezone.

The `profile` input defaults to `clean`, preserves fresh onboarding, and requires no provider credentials. `authenticated` uses a separate isolated profile and configures repository-owned test providers through the application's DataApi before completing onboarding. It sets global defaults for chat and translation. Existing assistants keep their own model choices, so scenarios using a built-in assistant must select the configured test model. The profile does not log in to CherryIN or create knowledge-base content. Required repository configuration is `CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL` and `CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL` (variables), plus `CHERRY_TEST_CUSTOM_PROVIDER_API_KEY` (secret). `CHERRY_TEST_CUSTOM_PROVIDER_ANTHROPIC_BASE_URL` is optional. To enable embedding scenarios, supply all three `CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_BASE_URL`, `CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_MODEL` (variables), and `CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_API_KEY` (secret). Missing or partial required configuration fails with exit 2 during Ubuntu request validation, before a desktop runner is allocated. Configuration is revalidated before application launch. Provider keys are available only to the validation/execution/finalization steps for configuration and redaction; raw plans and profiles remain excluded from artifacts. Never put secrets in dispatch plans.

## Results

```sh
gh run download <run-id> --repo CherryHQ/cherry-studio \
  -n qa-ondemand-<spec>-<platform>-<sha7> -D ./evidence
```

Artifacts last 30 days and include `results.json`, `results.md`, masked screenshots, and sanitized logs. Invalid requests use `qa-ondemand-input-errors-<run-id>`. Raw plans and profiles are not uploaded. GitHub job status only reports success/failure; parse `results.json` for classification.

`schemaVersion: 1` fixes these top-level fields: `schemaVersion`, `status`, `exitCode`, `failureStage`, `errors`, `metadata`, `environment`, `timings`, `steps`, `artifacts`. Within version 1 only optional fields may be added; incompatible changes require a new version. `status` is `passed`, `failed`, or `interrupted`; steps use `passed`, `failed`, or `not_run`.

| Exit code | Classification |
|---|---|
| 0 | All required steps, reporting, and cleanup passed |
| 1 | UI action/assertion not satisfied |
| 2 | Input, preparation, environment, installation, driver, report, or cleanup failed |
| 3 | Application not ready or connection unavailable |
| null | Interrupted; use GitHub's cancellation/timeout state too |

The priority for execution errors is `2 > 3 > 1 > 0`. Cleanup errors remain in `errors[]` but do not override an existing execution failure; cleanup failure alone returns 2. Categories identify execution stages, not confirmed product defects. `metadata` includes both SHAs and the target ref/mode/profile. `environment` includes runner/image versions, actual application version, locale, and timezones. Unavailable observations have a reason; application version is never inferred from a tag. `timings` separates preparation, readiness, and steps. Hard termination can prevent artifact upload; missing evidence cannot be counted as a pass. A handled interruption preserves a null classification; the final verdict process uses conventional termination status 130.

## Local verification

Run only explicitly selected tests under `scripts/e2e/ondemand/__tests__/` and affected regression consumers. Reviewed scenarios follow the [frontend testing rules](../../../docs/references/testing/frontend-testing.md). Local unit checks do not establish hosted Windows/macOS or release acceptance.
