---
description: How to log through the unified LoggerService in main and renderer, with levels, contexts, and env filtering
sources:
  - src/main/core/logger/LoggerService.ts
  - src/renderer/services/LoggerService.ts
  - src/main/services/sentry.ts
  - src/main/services/SentryService.ts
  - src/main/services/SentryEventFilter.ts
  - src/renderer/services/sentry.ts
  - src/shared/utils/sentry.ts
  - src/main/data/api/core/ApiServer.ts
  - src/renderer/components/FilePreview/FilePreview.tsx
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

Logging does not trigger Sentry uploads. Ordinary failures, including network,
provider, search, backup, and expected handled DataApi errors, stay in local logs for
user-initiated in-app feedback. `logger.error` is not a telemetry API.

Sentry reports unexpected unhandled exceptions, handled internal DataApi failures, explicitly reported render and
fatal startup failures, and Electron process crash, out-of-memory, launch-failure,
and integrity-failure summaries. Native memory dumps stay local for diagnostics;
the SDK does not upload them. Failures before preferences are readable remain
local under the consent gate, including early startup failures. No offline upload
queue or preboot consent copy is maintained.

`SentryService` subscribes during `BeforeReady` to service initialization failures.
It reports main-window initialization failures even though `MainWindowService`
uses the graceful lifecycle strategy, as well as failures from fail-fast services.
Other graceful service failures and post-startup hook errors remain local. The startup entry point
reports unexpected escaping errors and waits up to two seconds for sending
before exiting. Both the shared renderer error boundary and the file-preview
plugin boundary explicitly report render failures while retaining their fallbacks.

`ApiServer` emits the original caught error once for `INTERNAL_SERVER_ERROR` or
`DATA_INCONSISTENT`, preserving its stack and cause chain. `SentryService` subscribes
after `DataApiService` initializes and reports these errors with
`failure.kind=unexpected`. Expected request errors stay local; an HTTP error status
alone does not make an event eligible. Both service subscriptions are removed on
stop or destroy.

The main SDK applies the common policy to all windows. Non-fatal unexpected
cancellation and known transport failures are filtered. Explicit render/startup
failures and fatal exceptions remain eligible even when their cause is a network
error. Unknown unhandled errors, including `NOT_FOUND`, are not broadly ignored.
Normalized signatures ignore dynamic UUIDs and long numeric identifiers and
deduplicate interleaved events across windows for ten minutes. Per running app,
separate hourly budgets allow ten fatal/render/startup events and ten other
unexpected exceptions, including explicitly reported handled internal errors; filtered and duplicate events do not consume those
budgets. State is bounded, stays in memory, and resets on restart. Per-app limits
do not guarantee an organization-wide quota.

Pass the original `Error` as the first data argument and use a fixed operation identifier:

```typescript
logger.error('Save failed', error, { operation: 'translate.history.save' })
```

Keep the original error and a fixed operation identifier in local logs for
diagnosis. Sentry receives only the explicit failure context, not arbitrary log
context, and credentials are redacted. Never derive operation identifiers from
user input.

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
