# Agentic Electron E2E pilot

This standalone project evaluates [tester-army/e2e](https://github.com/tester-army/e2e)
against real Cherry Studio Electron windows on macOS. It complements the
[existing Playwright suites](../README.md); it is not a release or cross-platform gate.

## Install and run

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --dir tests/e2e/agentic install --frozen-lockfile
pnpm test:e2e:agentic
pnpm test:e2e:agentic --case notes
pnpm test:e2e:agentic --case chat --no-cache
```

Cases are `startup`, `settings`, `notes`, `chat`, and `chatRecovery`. Omit `--case`
to execute all five. `--run-dir /absolute/empty/directory` retains application data
and reports in a chosen empty directory. By default, each run gets a new system
temporary directory. Existing run evidence is never overwritten.

The driver checks model tool calling, prepares the Electron native dependency and
bundled binaries and utility processes, allocates free CDP/inspector ports, then runs cases sequentially.
Each case gets a fresh profile. Persistence cases stop and relaunch the real
Electron process with the same profile between write and read phases. The engine's
`app.restart()` and browser storage snapshots are not used for persistence proof.
Do not run Node SQLite tests concurrently: native rebuilds switch the driver's ABI.

The root `.env` or process environment must provide:

- `CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL`
- `CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL`
- `CHERRY_TEST_CUSTOM_PROVIDER_API_KEY`

Process variables take precedence. These configure the **testing Agent**. The app's
chat flows use the [shared loopback HTTP server](../../helpers/http/README.md) and a
dummy key. No external chat-provider availability is certified. For DeepSeek's
official endpoint, its [thinking-mode setting](https://api-docs.deepseek.com/guides/thinking_mode/)
`thinking.type=disabled` lets
the testing Agent use required tool calls.

The standalone workspace locks `e2e@0.21.1`, `@e2e-dev/web@0.15.1`, Playwright and
AI SDK 7 independently of the application's overrides and patches. Its pnpm
configuration permits the pinned esbuild installer and sets release age to zero
for this experimental toolchain. The root application lockfile is unchanged.

## GitHub Actions

The independent [Agentic Electron E2E workflow](../../../.github/workflows/e2e-agentic.yml)
runs credential-free tooling checks for relevant pull requests, including drafts.
Real desktop tests run only through `workflow_dispatch`, on `macos-15`, after the
tooling checks pass. They are not a required merge check. Scheduled runs remain
disabled until hosted acceptance and stability have been demonstrated.

Use **Actions → Agentic Electron E2E → Run workflow**. Select a reviewed branch
under **Use workflow from**; both tests and application use that run's exact SHA.
Only maintainers should dispatch reviewed, trusted code: test and installation
scripts execute code from the selected branch. Fork pull requests receive no
model credentials and never run desktop tests through `pull_request_target`.
The workflow must first exist on the default branch to become dispatchable, as
described in [GitHub's manual-run documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

| Input | Values | Behavior |
| --- | --- | --- |
| `case` | `all`, `startup`, `settings`, `notes`, `chat`, `chatRecovery` | Default `all`; fresh data for every selected case |
| `mode` | `run`, `acceptance` | Default `run`; acceptance requires `case=all` |

Reuse repository variables `CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL` and
`CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL`, and repository secret
`CHERRY_TEST_CUSTOM_PROVIDER_API_KEY`. Only the desktop execution step receives
the key through its environment; no `.env` file is generated. The application
continues to use the loopback HTTP fixture for chat.

`run` restores compatible Agent recordings and executes once. `acceptance`
starts with an empty action cache, runs all five cases cold and warm with distinct
profiles and inputs, and checks actual replay statistics and native restarts.
It then verifies the wrong-response assertion and screenshot, missing-key
preflight, and SIGTERM cleanup of the framework HTTP fixture and Electron listener.
The intentionally failed/blocked/interrupted subruns remain visible in the report;
acceptance succeeds only when their expected failure contracts are verified.

The same CI wrapper can be run locally:

```sh
pnpm --dir tests/e2e/agentic run ci --case startup --output /absolute/empty/ci-output
pnpm --dir tests/e2e/agentic run ci --mode acceptance --output /absolute/empty/acceptance-output
```

An existing local action cache is preserved and restored after acceptance.
CI caches pnpm downloads separately from Agent recordings; neither application
profiles nor native `node_modules` are cached. Agent cache keys include OS,
architecture, pinned runtime and dependencies, patch/test code, provider URL,
model, and selected case. Only a successful run with a clean secret scan saves
recordings; each save uses a new run ID so recordings can evolve across runs.

Job Summary shows cases, durations, calls, tokens, and replays, with API preflight
usage reported separately. The `agentic-e2e-macos-*` artifact contains portable
reports, traces, screenshots, redacted logs, native identities, and acceptance
proofs under `<output>/artifact`, retained for 14 days. Configured-secret scans
cover both evidence and action recordings; unsafe evidence is quarantined outside
the uploaded directory and fails the job. Profiles and raw temporary logs stay on
the runner. No evidence is uploaded by the credential-free PR job.

Runs on the same branch queue rather than cancel one another. The job limit is
60 minutes, with 50 minutes for desktop execution. Normal failures and ordinary
signals use the driver's owned-process cleanup; force termination can prevent
final reporting/cleanup and relies on disposal of the GitHub-hosted runner.
Local success does not establish hosted runner compatibility: the first manual
acceptance run must establish Electron UI, preload/IPC, and screenshots there.

## Cases and assertions

| Case | Regression caught |
| --- | --- |
| startup | Onboarding cannot be dismissed or the native chat composer cannot accept input |
| settings | Changing the theme is not applied or is lost after a real process restart |
| notes | Note edits disappear after navigation or process restart |
| chat | UI provider configuration cannot send a real HTTP request, or the streamed answer is not saved successfully |
| chatRecovery | A disconnected stream loses partial text, stays pending, is lost on restart, or prevents the next successful chat |

The Agent navigates, fills, and clicks. Semantic locator assertions verify every
important outcome. Public Preference/DataApi reads additionally verify persisted
state. Locale and unrelated onboarding/background features are prepared through
existing APIs. On the recovery read phase, only the provider's loopback URL changes
to the new fixture server port; the conversation and stored error are not rewritten.

## Cache and failure acceptance

The driver sets one worker, zero automatic retries, and a maximum of 20 actions
and 10 model calls per Agent operation. API preflight uses no retries. Missing
configuration, launch failures, and cleanup failures are reported as blocked;
assertion or Agent execution failures fail the case.

For cold/warm acceptance, start with an empty `.e2e/cache` directory and run the
full command twice. Both runs create new profiles; the second reuses only action
recordings. `--no-cache` disables both cache reading and writing, so it does not
prime a warm run. The framework records model calls and replay decisions in each
phase's `report.json` and `trace.md`. Unique inputs use `unique()` so new test data
can reuse verified recordings.

To verify the harness detects incorrect product output:

```sh
pnpm test:e2e:agentic --case chat --inject-failure
```

This intentionally supplies `WRONG RESPONSE` through the real HTTP server. The
normal chat assertion must fail and the command must exit nonzero. It is not a
passing product run.

## Evidence and cleanup

The terminal prints a summary under `.context/agentic-e2e/<run-id>/`. Each case
contains original framework JSON/Markdown reports, step traces, and screenshots;
sanitized Electron logs are copied alongside them. The summary includes model-call,
token, and replay counts; API preflight usage is listed separately. Full isolated profiles and
native-window identity records remain in the printed system run directory; case
markers and native identities are also copied into the evidence bundle.
The driver registers configured secrets with the framework and redacts console
output and copied logs. Raw temporary Electron logs remain local.
`--evidence-dir /absolute/empty/directory` overrides the default `.context` report
destination, allowing the CI wrapper to export a self-contained artifact.

Only driver-owned application processes are stopped. Other workspaces and their
ports are preserved. SIGINT/SIGTERM interrupt the active framework child and still
execute cleanup. Failure evidence and profiles are retained for diagnosis.

The engine uses the official persistent CDP connection with a pinned minimal
[explicit-target patch](upstream-connection.md). Every invocation binds the exact
native main-window target ID validated by the controller; it never chooses a
window by index. Each framework invocation gets a newly launched native process.
The optional `compatibility.test.ts` probe checks preload/IPC and captures a
screenshot; it needs `AGENTIC_APP_RECORD` and `AGENTIC_TARGET_ID` from the driver.

Validate locally with:

```sh
pnpm --dir tests/e2e/agentic typecheck
pnpm --dir tests/e2e/agentic test:connection
pnpm --dir tests/e2e/agentic test:ci
pnpm exec vitest run --project scripts scripts/e2e/regression/__tests__/process.test.ts scripts/e2e/regression/__tests__/launch.test.ts scripts/e2e/regression/__tests__/lifecycle.test.ts
pnpm docs:check
```
