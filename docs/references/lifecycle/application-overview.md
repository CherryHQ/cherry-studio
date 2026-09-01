---
description: How the Application orchestrator registers services, runs the three-phase bootstrap, and controls runtime shutdown
sources:
  - src/main/core/application
  - src/main/core/lifecycle
---

# Application Overview

Application is the top-level orchestrator that ties together the lifecycle system and the Electron app. It is the single entry point for bootstrapping, shutting down, and controlling services at runtime.

## Relationship to Lifecycle

```
Application          — "what to do" (register services, bootstrap, shutdown, runtime control)
  └── lifecycle/     — "how to do it" (IoC container, dependency resolution, state machine)
```

Application does not duplicate lifecycle logic. It delegates to `ServiceContainer` and `LifecycleManager` internally, while providing a clean, app-level API.

For lifecycle internals (phases, hooks, states, decorators, events), see [Lifecycle Overview](./lifecycle-overview.md).

## Quick Start

`application` is imported from the `@application` path alias, which resolves directly to `Application.ts` (configured in `tsconfig.node.json` and `electron.vite.config.ts`). The bootstrap-internal `serviceList` is imported directly from `serviceRegistry.ts` — it is not part of the `@application` surface, so importing the locator never pulls in the whole service graph:

```typescript
import { application } from '@application'
import { serviceList } from '@main/core/application/serviceRegistry'

// 1. Register all services
application.registerAll(serviceList)

// 2. Bootstrap (handles all three phases + Electron lifecycle)
await application.bootstrap()

// 3. Access a service
const dbService = application.get('DbService')
```

## Bootstrap Flow

`application.bootstrap()` orchestrates the full startup sequence:

```
setupSignalHandlers()                    ← SIGINT/SIGTERM → graceful shutdown
setupQuitHandlers()                      ← before-quit (preventQuit gate) + will-quit (shutdown)
    │
    ├── startPhase(Background)           ← fire-and-forget (non-blocking)
    │
    ├── startPhase(BeforeReady)  ─┐
    │                             ├──── run in parallel
    └── app.whenReady()          ─┘
            │
            ├── setupElectronHandlers()  ← window-all-closed, preventQuit IPC
            │
            ├── startPhase(WhenReady)    ← services requiring Electron API
            │
            ├── await Background         ← ensure background services finished
            │
            └── allReady()               ← notify all services the system is fully ready
```

If a `fail-fast` service throws during bootstrap, a dialog is shown offering Exit or Restart.

## Shutdown Flow

`application.shutdown()` is the convergence point for every *graceful* exit — `will-quit` is only where the Electron event chain converges. Routes in and out:

| Trigger | Route |
| ------- | ----- |
| Tray / menu quit, window close, `window-all-closed` | `application.quit()` → `before-quit` → `will-quit` → `shutdown()` |
| macOS Cmd+Q | Electron's built-in `app.quit()`, same chain |
| `SIGINT` / `SIGTERM` | handler awaits `shutdown()` directly, bypassing the Electron chain |
| Data reset | `dataReset.ts` calls `application.shutdown()` directly |
| System shutdown | `PowerService` gets us *into* this path; the OS does not wait for it to finish |
| `forceExit()` / `relaunch()` | **deliberately** bypass it — `app.exit()` straight away, no teardown |
| `kill -9`, crash, power loss | bypassed entirely — services self-heal on next start |

```
shutdown()
    ├── bootConfigService.flush()   ← save pending debounced writes
    ├── stopAll()                   ← onStop() in reverse initialization order
    ├── destroyAll()                ← onDestroy() in reverse initialization order
    └── loggerService.finish()      ← close logger (must be last)
```

`stopAll()` / `destroyAll()` cap each service at `SERVICE_STOP_TIMEOUT_MS` (5s), so one stuck `onStop()` no longer denies every service behind it its turn. Both return a summary of what timed out or failed, and the `Shutdown complete` line states whether the exit was clean — read it first when diagnosing a bad shutdown.

### The force-exit fuse

Each entry point arms a `SHUTDOWN_TIMEOUT_MS` (30s) `process.exit(1)` timer around `shutdown()`. It is a last resort, not the working mechanism:

- A healthy shutdown finishes in well under a second and never approaches it.
- It does **not** guarantee the per-service ceiling always runs to completion — six services each burning their full 5s reach it, and `stopAll()` + `destroyAll()` share the budget. Truncating past that point is correct; the app is already in a bad state.
- Like every timer-based bound here, it is powerless against a synchronously blocking `onStop()`, which never yields the event loop for the timer to fire on.

## Service Registry

Services are registered in `serviceRegistry.ts`. Adding a service is one line:

```typescript
// serviceRegistry.ts
import { NewService } from '@main/services/NewService'

export const services = {
  // ... existing services
  NewService,    // ← add one line, types are auto-derived
} as const
```

This gives you type-safe access via `application.get('NewService')`.

## Service Access Rules

Services managed by the lifecycle system must **not** export singleton instances. The service CLASS is exported for type references only (e.g., `ServiceRegistry`, `@DependsOn`). All runtime access goes through `application.get()` (unconditional services) or `application.getOptional()` (conditional services with `@Conditional`).

### Local variables are optional

Direct chaining is valid and common for a single call. Assign the result to a local variable when it is used repeatedly or when the shorter name improves readability:

```typescript
// One call: direct access is fine
application.get('PreferenceService').set('app.zoom_factor', 1)

// Repeated access: keep one readable local
const preferenceService = application.get('PreferenceService')
preferenceService.get('app.zoom_factor')
preferenceService.set('app.zoom_factor', 1)
```

### Conditional service access

Services with `@Conditional` must be accessed via `getOptional()`, which returns `T | undefined`. Using `get()` on a conditional service throws an error, even when the service is active on the current platform — this prevents cross-platform bugs.

```typescript
// ✗ BAD: get() on conditional service — throws even if service is active
const menu = application.get('AppMenuService')

// ✓ GOOD: getOptional() for conditional services
const menu = application.getOptional('AppMenuService')
menu?.buildMenu()
```

## Runtime Service Control

Control individual services at runtime without restarting the app:

```typescript
// Stop a service (cascades to dependents)
await application.stop('HeavyComputeService')

// Start a stopped service (re-runs onInit, cascades to dependents)
await application.start('HeavyComputeService')

// Restart = stop + start
await application.restart('HeavyComputeService')

// Pause/Resume (service must implement Pausable interface)
await application.pause('RealTimeService')
await application.resume('RealTimeService')
```

All operations cascade through the dependency graph automatically.

### Cascade Operations

When pausing/stopping a service, all services that depend on it are automatically paused/stopped first. When resuming/starting, dependent services are restored in reverse order.

```typescript
// If PreferenceService depends on DbService:
await application.stop('DbService')
// → PreferenceService is stopped first, then DbService

await application.start('DbService')
// → DbService is started first, then PreferenceService
```

**Important**: For pause/resume, ALL services in the cascade chain must implement `Pausable`. If any dependent service doesn't, the operation is aborted with an error log.

## App Relaunch

Always use `application.relaunch()` instead of calling `app.relaunch()` directly. It handles:

- **Dev mode detection**: Shows a dialog and exits gracefully (auto-relaunch is not possible in dev)
- **Platform fixes**: Linux AppImage `execPath` rewrite, Windows Portable executable path

```typescript
import { application } from '@application'

// Simple relaunch
application.relaunch()

// With custom options (forwarded to Electron's app.relaunch)
application.relaunch({ args: ['--safe-mode'] })
```

## App Quit

Always use `application.quit()` or `application.forceExit()` instead of calling `app.quit()` / `app.exit()` directly. The Oxlint rule `cherry/no-direct-quit` warns if quit APIs or signals are used in `src/main/` outside of `Application.ts`.

```typescript
import { application } from '@application'

// Graceful quit — triggers the Electron before-quit / will-quit event chain
application.quit()

// Force exit — skips the event chain, for fatal/unrecoverable errors only
application.forceExit(1)

// Mark as quitting without triggering quit — for external quit flows (e.g. autoUpdater)
application.markQuitting()

// Prevent quit during critical operations (e.g. data migration)
const hold = application.preventQuit('Migrating data')
try { /* critical work */ } finally { hold.dispose() }

// Check quit status
if (application.isQuitting) { /* ... */ }
```

| Method | Event chain | Use case |
|--------|-------------|----------|
| `quit()` | Triggers `before-quit` → `will-quit` | Normal user-initiated quit |
| `forceExit(code)` | Skipped | Fatal errors, repeated renderer crash |
| `markQuitting()` | None (flag only) | `autoUpdater.quitAndInstall()` owns its own quit flow |
| `preventQuit(reason)` | Blocks `before-quit` | Critical operations (returns hold with `dispose()`) |

**Exception:** migration-window code under `src/main/data/migration/` owns a separate pre-bootstrap Electron flow and is excluded from the lint rule. Other preboot code, including the single-instance gate, still calls `application.quit()` rather than a bare Electron quit API.

### Renderer Usage

The renderer's legacy application bridge exposes quit-prevention and relaunch operations. It does not expose a generic `quit()` method. New call sites that only need a normal relaunch use `ipcApi.request('app.relaunch')`; the bridge remains for the quit-hold protocol and legacy relaunch callers that pass Electron options.

```typescript
// Relaunch the app
await window.api.application.relaunch()
await window.api.application.relaunch({ args: ['--safe-mode'] })

// Prevent quit during critical operations (returns opaque holdId)
const holdId = await window.api.application.preventQuit('Migrating user data')
try {
  await performCriticalWork()
} finally {
  await window.api.application.allowQuit(holdId)
}
```

| Method | Returns | Description |
|--------|---------|-------------|
| `relaunch(options?)` | `Promise<void>` | Relaunch the app (with optional args) |
| `preventQuit(reason)` | `Promise<string>` (holdId) | Block app quit until released |
| `allowQuit(holdId)` | `Promise<void>` | Release a specific quit prevention hold |

## The `application` Proxy

The exported `application` constant is a lazy proxy — safe to import at module top level before `bootstrap()` is called. The actual `Application` instance is created on first property access.

```typescript
// Safe to import anywhere, even at module scope
import { application } from '@application'
```

## File Structure

```
application/
├── Application.ts      # Application singleton + lazy proxy — the `@application` alias target
└── serviceRegistry.ts  # Central service registry (add services here); imported directly, no barrel
```
