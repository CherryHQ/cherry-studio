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

```typescript
import { application } from '@main/core/application'
import { serviceList } from '@main/core/application'

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

`application.shutdown()` is called automatically on:
- `will-quit` (Electron event, after all windows closed)
- `SIGINT` / `SIGTERM` (with 5-second force-exit timeout, bypasses Electron event chain)

```
shutdown()
    ├── bootConfigService.flush()   ← save pending debounced writes
    ├── stopAll()                   ← onStop() in reverse initialization order
    ├── destroyAll()                ← onDestroy() in reverse initialization order
    └── loggerService.finish()      ← close logger (must be last)
```

On non-macOS, `window-all-closed` triggers `application.quit()` which flows through `before-quit` → `will-quit` → `shutdown()`.

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

### Assign to a local variable before use

Do **not** chain `application.get('...')` with method calls directly. Assign the service to a local variable first, then use it:

```typescript
// ✗ BAD: chained calls
application.get('PreferenceService').get('app.zoom_factor')
application.get('PreferenceService').set('app.zoom_factor', 1)

// ✓ GOOD: assign first, then use
const preferenceService = application.get('PreferenceService')
preferenceService.get('app.zoom_factor')
preferenceService.set('app.zoom_factor', 1)
```

This improves readability, avoids repeated container lookups, and makes the code easier to refactor.

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
import { application } from '@main/core/application'

// Simple relaunch
application.relaunch()

// With custom options (forwarded to Electron's app.relaunch)
application.relaunch({ args: ['--safe-mode'] })
```

## App Quit

Always use `application.quit()` or `application.forceExit()` instead of calling `app.quit()` / `app.exit()` directly. An ESLint rule (`no-restricted-properties`) will warn if `app.quit()` or `app.exit()` is used in `src/main/` outside of `Application.ts`.

```typescript
import { application } from '@main/core/application'

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

**Exceptions** (where direct `app.quit()` is acceptable):
- Before `application` is initialized (e.g., single-instance lock failure in `index.ts`)
- Migration files (`src/main/data/migration/`) that run before the full app lifecycle

### Renderer Usage

The renderer accesses application lifecycle methods via `window.api.application`:

```typescript
// Quit the app (triggers before-quit → will-quit event chain)
await window.api.application.quit()

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
| `quit()` | `Promise<void>` | Graceful quit via Electron event chain |
| `relaunch(options?)` | `Promise<void>` | Relaunch the app (with optional args) |
| `preventQuit(reason)` | `Promise<string>` (holdId) | Block app quit until released |
| `allowQuit(holdId)` | `Promise<void>` | Release a specific quit prevention hold |

## The `application` Proxy

The exported `application` constant is a lazy proxy — safe to import at module top level before `bootstrap()` is called. The actual `Application` instance is created on first property access.

```typescript
// Safe to import anywhere, even at module scope
import { application } from '@main/core/application'
```

## File Structure

```
application/
├── Application.ts      # Application singleton + lazy proxy
├── serviceRegistry.ts  # Central service registry (add services here)
└── index.ts            # Barrel export
```
