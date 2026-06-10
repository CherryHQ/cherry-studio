# Performance Diagnostics

Opt-in performance instrumentation for the main process, gated by the `CS_DIAGNOSTICS` env var. Default off → zero overhead in a normal run.

The facility lives in [`src/main/core/diagnostics.ts`](../../src/main/core/diagnostics.ts); individual probes live next to the code they measure and check the same `DIAGNOSTICS_ENABLED` flag.

## Enable

Diagnostics is controlled entirely by the `CS_DIAGNOSTICS` env var reaching the **main process**; all signals turn on together. The packaged build is not special — the same production binary runs with extra instrumentation when the flag is present.

### Dev

```bash
CS_DIAGNOSTICS=1 pnpm dev
```

### Packaged build (non-dev)

Double-clicking from Finder / Dock / Start Menu does **not** pass shell env vars, so diagnostics stays off. Launch the app binary **from a terminal** so the variable reaches the main process:

```bash
# macOS
CS_DIAGNOSTICS=1 "/Applications/Cherry Studio.app/Contents/MacOS/Cherry Studio"

# Windows (PowerShell) — adjust the path to your install location
$env:CS_DIAGNOSTICS=1; & "$env:LOCALAPPDATA\Programs\Cherry Studio\Cherry Studio.exe"

# Linux (AppImage; or the installed binary, whose path varies by distro)
CS_DIAGNOSTICS=1 "./Cherry Studio-<version>-<arch>.AppImage"
```

### Output

Both dev and packaged runs write to the **app logs directory** (`~/Library/Logs/CherryStudio/` on macOS; `application.getPath('app.logs')`): signals stream into `app.<date>.log`, and the CPU profile lands beside it as `boot-whenReady.cpuprofile`.

## Signals

| Signal | Log tag | Where | What it tells you |
|--------|---------|-------|-------------------|
| Per-service init timing | `[Diagnostics/_doInit]` | `BaseService._doInit` | `onInit` vs `onReady` duration per service. Wall-clock — in a parallel layer it absorbs sibling sync work (see Caveats). |
| Phase service spans | `[Diagnostics]` | `LifecycleManager.startPhase` | Each service's start/end offset from the phase epoch. A whole layer ending at the same instant ⇒ one service holds the thread. |
| Event-loop lag | `[Diagnostics]` | `LifecycleManager.startPhase` | `totalLag` high ⇒ loop blocked by sync work; near-zero over a long span ⇒ IO/macrotask bound. `fires=0` ⇒ pure microtask cascade (timer never ran). |
| whenReady CPU profile | `[Diagnostics] CPU profile written to …` | `LifecycleManager.startPhase` | V8 sampling profile of the whenReady phase. Self-time by function — the only reliable attribution when startup is one microtask chain. |
| Slow DB queries | `[Diagnostics/slow-query]` | `DbService.installSlowQueryProbe` | Any query >15ms: duration, row count, SQL, caller stack. Covers single statements, batches, and interactive-transaction interiors. |
| Slow IPC handlers | `[Diagnostics/ipc]` | `BaseService.ipcHandle` | Any service IPC handler >50ms: duration + channel. Covers handlers registered via `this.ipcHandle()` (most); direct `ipcMain.handle` in `ipc.ts` is not covered. |
| Window creation | `[Diagnostics/window]` | `WindowManager.createWindow` | Per window: synchronous construction cost, then `ready-to-show` paint latency from the same start. |
| Slow DataApi requests | `[Diagnostics/dataapi]` | `ApiServer.handleRequest` | Any DataApi request >50ms: duration + `method path`. Duration is measured monotonically (`performance.now()`) and only computed when enabled. |
| Verbose logging | — | `LoggerService` (main + renderer) | The flag makes the logger behave exactly as in dev: file level drops to `silly`, console output turns on, and the `CSLOGGER_*` filters become active in the packaged build. See [Logging](./logging.md#filtering-logs-with-environment-variables). |

The `slow-*` thresholds are defined in one place — `SLOW_THRESHOLD_MS` in `src/main/core/diagnostics.ts`.

## Reading the CPU profile

Written to `boot-whenReady.cpuprofile` in the app logs directory (next to `app.<date>.log`; `application.getPath('app.logs')`). Open in Chrome DevTools (Performance → Load profile) or VS Code's built-in `.cpuprofile` viewer. Sort by **self time** for true CPU attribution.

Sampling interval is 1000µs (V8 default). Do not lower it — 100µs oversamples ~10x and adds ~135ms of inspector overhead that only taxes the profiled whenReady phase, drowning out sub-100ms deltas.

## Caveats

- **Per-service `_doInit` timing is contaminated in parallel layers.** Services in one layer run via `Promise.allSettled`; `await this.onReady()` yields a microtask during which a sibling's synchronous body runs to completion and is billed to whichever service is being measured. Trust the CPU profile's self-time for real attribution, not the per-service numbers.
- **The slow-query probe wraps libsql, not drizzle.** drizzle's own `logger` option logs every statement (including transaction interiors) but carries no timing, so it cannot flag *slow* queries. The probe instead wraps the libsql `client.execute`/`batch` plus the `tx.execute`/`tx.batch` of each `client.transaction()` — every path drizzle issues queries through. Not wrapped: raw `executeMultiple` and the migration `client.migrate` (neither is a normal query path).

## Adding a new diagnostic

1. Import the flag where the code lives: `import { DIAGNOSTICS_ENABLED } from '@main/core/diagnostics'`.
2. Guard the probe: `if (DIAGNOSTICS_ENABLED) { … }` — the disabled path must stay zero-cost. For a slow-event probe, add a threshold to `SLOW_THRESHOLD_MS` instead of hardcoding ms.
3. Tag logs `[Diagnostics/<name>]` so they grep together.
4. Add a row to the Signals table above.
