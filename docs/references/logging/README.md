---
description: How to log through the unified LoggerService in main and renderer, with levels, contexts, and env filtering
sources:
  - src/main/core/logger/LoggerService.ts
  - src/main/core/logger/logFailure.ts
  - src/main/data/failureFacts.ts
  - src/main/services/file/failureFacts.ts
  - src/main/services/file/FileEditService.ts
  - src/main/services/remoteStorage/failureFacts.ts
  - src/renderer/services/LoggerService.ts
  - src/main/services/errorReporting/sentry.ts
  - src/main/services/errorReporting/ErrorReportingService.ts
  - src/renderer/services/sentry.ts
  - src/shared/utils/sentry.ts
  - src/main/ai/errorReporting.ts
  - src/main/ai/runtime/aiSdk/failureFacts.ts
  - src/main/ai/mcp/failureFacts.ts
---

# How to use the LoggerService

This is a developer document on how to use the logger.

CherryStudio uses a unified logging service to print and record logs. **Unless there is a special reason, do not use `console.xxx` to print logs**.

## Error reporting

Production Sentry uploads require data collection to be enabled and the current
privacy policy to be accepted. Disabling collection blocks outbound reporting;
local logging continues.

The main-process SDK initializes during preboot in `sentry.ts`, so automatic
exception capture is installed before lifecycle services start. Reporting stays
blocked until `PreferenceService` is ready and consent is valid; the same check
runs before sending each envelope, including after preferences stop.

`ErrorReportingService` owns the main logger's error observer and the final
Sentry event policy. It starts in `BeforeReady` after `PreferenceService`, whose
own dependency is `DbService`. Business services must not depend on reporting:
stopping telemetry must never cascade into an Agent or a window. The service
imports no AI runtime, data API, or diagnostic-bundle implementation.

The SDK installs automatic exception handlers during preboot. Its `beforeSend`
and transport consult only the already-existing reporting service. Before that
service is ready, after it stops, or without consent, outbound reporting is
blocked. Startup database/migration failures therefore still require local
logs or a diagnostic bundle. No offline event queue is maintained.

Pass an original `Error` and a fixed operation identifier for ordinary failures:

```typescript
logger.error('Save failed', error, {
  operation: 'translate.history.save',
  failure: {
    source: 'application',
    kind: 'reliability',
    reason: 'persistence_failed',
    outcome: 'failed'
  }
})
```

`FailureFacts` describes source, kind, stable reason, outcome, and optional
runtime. Domain classifiers stay with their owners; shared policy decides
whether those facts warrant reporting. Expected failures and cancellation stay
local. Retrying failures stay local unless they are program defects. Recovered
internal faults remain eligible. Structured failures can be captured without a
JavaScript stack, such as a renderer process crash.

Claude and Pi classify SDK results before losing their semantics. Execution
limits, known provider failures and cancellation do not become product errors;
unknown SDK failures remain eligible. Runtime logging preserves bounded payload
shapes and marks capture ownership on extensible errors. IPC serializes that
ownership so renderer logging and global capture do not recapture the failure.

Ordinary chat classifies AI SDK failures at the Agent boundary, before stream
management or IPC projects them. Typed provider authentication, quota, rate
limit, model availability, context limits and network/server failures stay
local, including exhausted retry wrappers. Unclassified HTTP 400 failures,
response/schema parsing failures and native programming errors remain eligible.
Tool-input rejection and the configured tool-loop limit are expected outcomes.
The AI helper preserves the SDK's original thrown value and applies the same
ownership marker to Error instances and structured provider events.

MCP owns classification at connection and request boundaries. Known external
transport failures, protocol rejections, missing capabilities, auth and
configuration failures stay local. The corresponding built-in server protocol
failures remain reportable, as do invalid client lifecycle states and native
programming errors. A tool's `isError` result stays a tool outcome. Server names,
URLs, arguments and result bodies are not copied into reporting context.

After consent, classification and rate limits accept an event, the main process
writes `Error report accepted for delivery` with its Sentry `event_id` as
`reportId` in the local application log. A diagnostic bundle that includes the
log can be matched to that report without uploading the bundle. This records
acceptance for delivery, not successful ingestion; transport can still fail or
consent can be revoked before sending. Dropped events create no such reference.

DataApi classifies after business error translation: validation and explicit
conflicts stay local; unhandled SQLite constraints, corrupt storage, inconsistent
data and missing handlers remain eligible. The response carries reporting
ownership through `DataApiError` serialization. Database initialization and
preboot migration log the same facts, but cannot report before consent is ready.

File IPC classifies at its domain boundary. Missing or unwritable user-selected
paths stay local; missing managed files and metadata failures after a content
commit remain eligible. Metadata lookups still return null on failure, while
unexpected faults are recorded. File editing classifies normalized `FILE_EDIT_*`
codes in `FileEditService`, where each lease retains whether its target is an
external file or managed storage. This includes external library entries and
read/write requests carrying only an `editId`; IPC propagates reporting ownership.
Missing, permission-denied and full-disk external targets stay local, while the
same managed-storage failures and generic editing I/O failures remain eligible.
Word export uses the external-path policy.
Backup/restore retain snapshot and integrity failures; busy writers and
unsupported backup versions stay local. WebDAV/S3 classify at their SDK
boundaries so authentication, remote availability and network failures do not
escape through the outer backup logger. Update cancellation and temporary
network failures stay local; broken feeds, signatures and checksums remain eligible.

Sensitive data/storage boundaries use `core/logger/logFailure`: local diagnostics
retain the error, while reporting receives only stable facts and stack frames.
SQL text, parameters, remote responses and file contents are not reporting fields.
These helpers do not resolve lifecycle services or depend on Sentry.

Unmigrated error logs with stacks retain compatibility capture. In the main
process, each unknown/legacy signature gets at most one event per ten minutes;
other signatures get at most five. Two independent hourly budgets each admit at
most ten events: one for critical stability failures and one for other eligible
unexpected failures. Critical events are fatal or unhandled exceptions, renderer
process exits, React render failures, and failures at the database/migration
startup boundaries (`database.open`, `database.migrate`, `migration.open`,
`migration.check`). Consent, expected-failure filtering and capture ownership
apply before either budget; ordinary errors cannot consume the critical reserve.
The conservative ten-plus-ten limits bound a running application's volume while
preserving capacity to diagnose a crash after an unrelated error burst. All
windows share the budgets at the main-process boundary.

A bounded 256-entry LRU tracks signatures using budget class, module, operation,
failure classification and stack frames, never session IDs or error messages.
Stopping the service releases its counters, signatures and logger observer;
restarting attaches one observer. Sentry SDK listeners remain installed, but
the stopped service blocks their outbound events too.

These in-memory limits reset on restart and do not enforce the Sentry project's
aggregate quota across installations. Project-wide control requires server-side
quota/rate limits and sampling adjusted to actual volume; it is not provided by
these client counters.

Reports allow only module/window/process, operation, string error code, failure
facts and React component stack from log context. Arbitrary business context is
excluded and credentials are redacted. Never derive operation identifiers or
failure reasons from user input; use letters, digits, dots, underscores or
hyphens, starting with a letter (max 80 characters).

Renderer errors are captured in their originating process to retain causes and source-map
Debug IDs. Both processes share the package-based release and `app.version`,
`app.edition` (`global` / `cn`), and `app.channel` (prerelease identifier or `stable`).

The following are detailed instructions.

## Usage in the `main` process

### Importing

```typescript
import { loggerService } from '@logger'
```

### Setting module information (Required by convention)

After the import statements, set it up as follows:

```typescript
const logger = loggerService.withContext('moduleName')
```

- `moduleName` is the name of the current file's module. It can be named after the filename, main class name, main function name, etc. The principle is to be clear and understandable.
- `moduleName` will be printed in the terminal and will also be present in the file log, making it easier to filter.

### Setting `CONTEXT` information (Optional)

In `withContext`, you can also set other `CONTEXT` information:

```typescript
const logger = loggerService.withContext('moduleName', CONTEXT)
```

- `CONTEXT` is an object of the form `{ key: value, ... }`.
- `CONTEXT` information will not be printed in the terminal, but it will be recorded in the file log, making it easier to filter.

### Logging

In your code, you can call `logger` at any time to record logs. The supported levels are: `error`, `warn`, `info`, `verbose`, `debug`, and `silly`.
For the meaning of each level, please refer to the subsequent sections.

Logging methods take a string message followed by optional `Error` and/or object context values (using `logger.LEVEL` as an example):

```typescript
logger.LEVEL(message)
logger.LEVEL(message, CONTEXT)
logger.LEVEL(message, error)
logger.LEVEL(message, error, CONTEXT)
logger.LEVEL(message, CONTEXT, MORE_CONTEXT)
```

| Parameter | Type     | Description                                                                                                                                                                                                                                                                                                                   |
| --------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message` | `string` | Required. This is the core field of the log, containing the main content to be recorded.                                                                                                                                                                                                                                      |
| `CONTEXT` | `object` | Optional. Additional information to be recorded in the log file. It is recommended to use the `{ key: value, ...}` format.                                                                                                                                                                                                    |
| `error`   | `Error`  | Optional. The error stack trace will also be printed.<br />Note that the `error` caught by `catch(error)` is of the `unknown` type. According to TypeScript best practices, you should first use `instanceof` for type checking. If you are certain it is an `Error` type, you can also use a type assertion like `as Error`. |

#### Recording non-`object` type context information

```typescript
const foo = getFoo()
logger.debug(`foo ${foo}`)
```

### Log Levels

- In the development environment, all log levels are printed to the terminal and recorded in the file log.
- In the production environment, the default log level is `info`. Logs are only recorded to the file and are not printed to the terminal.

Changing the log level:

- You can change the log level with `logger.setLevel('newLevel')`.
- `logger.resetLevel()` resets it to the default level.
- `logger.getLevel()` gets the current log level.

**Note:** Changing the log level has a global effect. Please do not change it arbitrarily in your code unless you are very clear about what you are doing.

## Usage in the `renderer` process

Usage in the `renderer` process for _importing_, _setting module information_, and _setting context information_ is **exactly the same** as in the `main` process.
The following section focuses on the differences.

### Window source

In the `renderer` process there are different `window`s, so each log records which window it came from. Every window declares its source declaratively in its `index.html`:

```html
<meta name="logger-window-source" content="mainWindow" />
```

`LoggerService` reads this meta tag when it is constructed. Because the `<meta>` is parsed before any module script runs, the source is available before any import-time log — there are no ordering rules to follow in `entryPoint.tsx`.

- The `content` value is recorded in the `main` process terminal and the file log; it is not printed in the `devTool`'s `console`.
- If a window has no meta tag (and no explicit override), early logs fall back to `UNKNOWN` and a `console.error` is printed.

#### `initWindowSource` (explicit override)

Documentless contexts such as workers — and any special case — set the source explicitly. An explicit source overrides the meta-derived one:

```typescript
loggerService.initWindowSource('Worker')
```

- It can only be set once; subsequent attempts have no effect.
- It returns the LoggerService instance, allowing for method chaining.

### Log Levels

- In the development environment, all log levels are printed to the `devTool`'s `console` by default.
- In the production environment, the default log level is `info`, and logs are printed to the `devTool`'s `console`.
- In both development and production environments, `warn` and `error` level logs are, by default, transmitted to the `main` process and recorded in the file log.
  - In the development environment, the `main` process terminal will also print the logs transmitted from the renderer.

#### Changing the Log Level

Same as in the `main` process, you can manage the log level using `setLevel('level')`, `resetLevel()`, and `getLevel()`.
Similarly, changing the log level is a global adjustment.

#### Changing the Level Transmitted to `main`

Logs from the `renderer` are sent to `main` to be managed and recorded to a file centrally (according to `main`'s file logging level). By default, only `warn` and `error` level logs are transmitted to `main`.

There are two ways to change the log level for transmission to `main`:

##### Global Change

The following methods can be used to set, reset, and get the log level for transmission to `main`, respectively.

```typescript
logger.setLogToMainLevel('newLevel')
logger.resetLogToMainLevel()
logger.getLogToMainLevel()
```

**Note:** This method has a global effect. Please do not change it arbitrarily in your code unless you are very clear about what you are doing.

##### Per-log Change

By adding `{ logToMain: true }` at the end of the log call, you can force a single log entry to be transmitted to `main` (bypassing the global log level restriction), for example:

```typescript
logger.info('message', { logToMain: true })
```

## About `worker` Threads

- Currently, logging is not supported for workers in the `main` process.
- Logging is supported for workers started in the `renderer` process, but currently these logs are not sent to `main` for recording.

### How to Use Logging in `renderer` Workers

Since worker threads are independent, using LoggerService in them is equivalent to using it in a new `renderer` window. Therefore, you must first call `initWindowSource`.

If the worker is relatively simple (just one file), you can also use method chaining directly:

```typescript
const logger = loggerService.initWindowSource('Worker').withContext('LetsWork')
```

## Filtering Logs with Environment Variables

In a development environment, you can define environment variables to filter displayed logs by level and module. This helps developers focus on their specific logs and improves development efficiency.

Environment variables can be set in the terminal or defined in the `.env` file in the project's root directory. The available variables are as follows:

| Variable Name                    | Description                                                                                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CSLOGGER_MAIN_LEVEL`            | Log level for the `main` process. Logs below this level will not be displayed.                                                                                              |
| `CSLOGGER_MAIN_SHOW_MODULES`     | Filters log modules for the `main` process. Use a comma (`,`) to separate modules. The filter is case-sensitive. Only logs from modules in this list will be displayed.     |
| `CSLOGGER_RENDERER_LEVEL`        | Log level for the `renderer` process. Logs below this level will not be displayed.                                                                                          |
| `CSLOGGER_RENDERER_SHOW_MODULES` | Filters log modules for the `renderer` process. Use a comma (`,`) to separate modules. The filter is case-sensitive. Only logs from modules in this list will be displayed. |

Example:

```bash
CSLOGGER_MAIN_LEVEL=verbose
CSLOGGER_MAIN_SHOW_MODULES=McpService,SelectionService
```

Note:

- By default these variables are only effective in the development environment. To enable them in a packaged build, launch it with `CS_DIAGNOSTICS` set — the logger then behaves exactly as in dev (verbose file level, console output, and these overrides all turn on). See [Performance Diagnostics](../diagnostics/README.md).
- These variables only affect the logs displayed in the terminal or DevTools. They do not affect file logging or the `logToMain` recording logic.

## Log Level Usage Guidelines

There are many log levels. The following are the guidelines that should be followed in CherryStudio for when to use each level:
(Arranged from highest to lowest log level)

| Log Level     | Core Definition & Use case                                                                                                                                                                          | Example                                                                                                                                                                                                            |
| :------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`error`**   | **Critical error causing the program to crash or core functionality to become unusable.** <br> This is the highest-priority log, usually requiring immediate reporting or user notification.        | - Main or renderer process crash. <br> - Failure to read/write critical user data files (e.g., database, configuration files), preventing the application from running. <br> - All unhandled exceptions.           |
| **`warn`**    | **Potential issue or unexpected situation that does not affect the program's core functionality.** <br> The program can recover or use a fallback.                                                  | - Configuration file `settings.json` is missing; started with default settings. <br> - Auto-update check failed, but does not affect the use of the current version. <br> - A non-essential plugin failed to load. |
| **`info`**    | **Records application lifecycle events and key user actions.** <br> This is the default level that should be recorded in a production release to trace the user's main operational path.            | - Application start, exit. <br> - User successfully opens/saves a file. <br> - Main window created/closed. <br> - Starting an important task (e.g., "Start video export").                                         |
| **`debug`**   | **Diagnostic information useful during ordinary development and debugging.** <br> It is below the production `info` threshold by default. | - A selected execution branch. <br> - Safe identifiers and timing details. <br> - A cache hit/miss. |
| **`verbose`** | **More detailed execution-flow tracing than `debug`.** <br> Use it for noisy step-by-step diagnostics that are normally hidden. | - Loading a UI module. <br> - An IPC route being invoked. <br> - Individual stages in a multi-step operation. |
| **`silly`**   | **The most detailed, low-level information, used only for extreme debugging.** <br> Rarely used in regular development; only for solving very difficult problems.                                   | - Real-time mouse coordinates `(x: 150, y: 320)`. <br> - Size of each data chunk when reading a file. <br> - Time taken for each rendered frame.                                                                   |

Never log secrets, authorization headers, full prompts, or user file contents at any level. Lower levels are still written to files in development and when diagnostics is enabled.
