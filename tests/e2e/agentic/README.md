# Agentic Electron E2E pilot

This standalone project evaluates [tester-army/e2e](https://github.com/tester-army/e2e)
against real Cherry Studio Electron windows on local macOS. It complements the
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
native-window identity records remain in the printed system run directory.
The driver registers configured secrets with the framework and redacts console
output and copied logs. Raw temporary Electron logs remain local.

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
pnpm exec vitest run --project scripts scripts/e2e/regression/__tests__/process.test.ts scripts/e2e/regression/__tests__/launch.test.ts scripts/e2e/regression/__tests__/lifecycle.test.ts
pnpm docs:check
```
