---
description: Current Python code-block execution path through CodeBlockView, PyodideService, and the Pyodide Web Worker
sources:
  - src/renderer/components/CodeBlockView
  - src/renderer/services/PyodideService.ts
  - src/renderer/workers/pyodide.worker.ts
  - src/main/services/PythonService.ts
---

# Code Execution

Python fenced-code blocks can run in the renderer through Pyodide. Execution
happens in a Web Worker so loading packages and running Python do not block the
React UI thread.

## Activation

`CodeBlockView` exposes the run tool only when both conditions hold:

- the block language is `python`;
- `chat.code.execution.enabled` is true.

The timeout comes from `chat.code.execution.timeout_minutes` and defaults to one
minute. Clicking Run calls
`pyodideService.runScript(source, {}, timeoutMinutes * 60_000)` using the latest
source held by the workbench. The returned `{ text, image? }` renders below the
code surface in `StatusBar`.

## Runtime flow

```text
CodeBlockView
  → PyodideService.runScript
    → initialize one shared pyodide.worker
    → postMessage({ id, python, context })
      → loadPackagesFromImports(python)
      → runPythonAsync(python)
      → postMessage({ id, output })
    → formatOutput(output)
  → StatusBar text and optional image
```

`PyodideService` owns worker initialization, request IDs, response resolvers,
timeouts, reset, and termination. Initialization is shared across calls and may
retry up to five times.

Runs are serialized through an internal promise queue. Pyodide executes Python
synchronously on the worker thread and the worker keeps one module-level output
buffer, so a second run reaches the worker only after the previous one settles,
and each run's timeout is measured from the moment it leaves the queue rather
than from when it was requested. A run that times out terminates the worker —
the only way to release a thread pinned by runaway Python — and the next queued
run lazily rebuilds it through `initialize()`.

The service also listens for the legacy
`IpcChannel.Python_ExecutionRequest` renderer event and replies on
`Python_ExecutionResponse`, allowing a main-process caller to use the same
worker. `PythonService` in the main process holds the caller-facing budget for
those requests and broadcasts `Python_ExecutionCancel` with the request id when
it expires. The renderer skips the request if it is still queued, and terminates
the worker if it is already running, so a caller told that its run timed out
never leaves Python executing behind it. `runScript` takes an optional
`AbortSignal` to carry that cancellation.

## Worker behavior

The worker loads Pyodide 0.28.0 from jsDelivr, so first use and newly imported
packages require network access. For each request it:

1. creates a fresh Python globals dictionary;
2. calls `loadPackagesFromImports` for packages named by the source;
3. injects a Matplotlib shim when the source contains `matplotlib`;
4. runs the source with `runPythonAsync`;
5. converts proxy results into structured-cloneable JavaScript values;
6. captures stdout, stderr, execution errors, and an optional Matplotlib PNG;
7. destroys the per-request globals dictionary.

The `context` field is part of the service message shape but is not currently
injected into the Python globals.

## Output and failure semantics

`PyodideService.formatOutput` prefers stdout, otherwise formats the expression
result, then appends stderr/errors. A run with no output returns
`Execution completed with no output.` Initialization, timeout, cancellation, and
internal failures resolve to user-visible text instead of rejecting the UI call.

Matplotlib's patched `show()` saves the current figure to an in-memory PNG data
URL. `CodeBlockView` displays that image together with any text result.

## Security boundary

The worker isolates computation from the UI thread, but it is not a security
sandbox for untrusted Python. It downloads the Pyodide runtime and imported
packages, and executes the supplied source. The feature is therefore disabled by
default and must remain an explicit user setting.

## Verification

The UI contract is covered by:

```bash
pnpm test:renderer src/renderer/components/CodeBlockView/__tests__/CodeBlockView.test.tsx
```

Serialization, timeout-terminates-worker, and the cross-process cancel handshake
are covered by:

```bash
pnpm exec vitest run --project renderer src/renderer/services/__tests__/PyodideService.test.ts
pnpm exec vitest run --project main src/main/services/__tests__/PythonService.test.ts
```

Changes to the service or worker also require a manual run that covers initial
runtime download, package loading, timeout reporting, stdout/stderr, and
Matplotlib image output; the worker layer has no dedicated automated tests.
