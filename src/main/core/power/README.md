# Power

The system power hub. A single lifecycle-managed service (`PowerService`) that owns
every Electron `powerMonitor` / `powerSaveBlocker` concern so the rest of the app never
touches those APIs directly.

## Responsibilities

| Area | What it provides |
|------|------------------|
| **Notification events** | Typed `Emitter`→`Event` for `onSuspend` / `onResume` / `onLockScreen` / `onUnlockScreen` / `onPowerSourceChange`. suspend/resume + power-source are de-duplicated against internal state (macOS double-fires — electron/electron#24803); lock/unlock are pass-through. |
| **Shutdown barrier** | `registerShutdownHandler(fn)` → `Disposable`. On OS shutdown, handlers run serially and are bounded by a hard timeout, then the app quits. Cross-platform: `powerMonitor` `shutdown` + `preventDefault` on macOS/Linux, `@paymoapp/electron-shutdown-handler` on Windows. |
| **Sleep prevention** | `preventSleep(reason?)` → `Disposable`. Ref-counted holds; the OS blocker (`prevent-app-suspension`) is active only while **a hold is held AND** the user opted in via `app.power.prevent_sleep_when_busy`. `isPreventingSleep()` reports the effective state. |
| **Queries** | `getPowerPhase()` / `getPowerSource()` / `isOnBatteryPower()` / `getSystemIdleTime()` / `getSystemIdleState(thresholdSec)` — level-triggered, so a late caller reconciles current state without having seen the edge. |

## Quick Start

```ts
import { application } from '@application'

const power = application.get('PowerService')

// Keep the machine awake for the duration of some work (effective only if the user
// enabled `app.power.prevent_sleep_when_busy`):
const hold = power.preventSleep('job:export')
try {
  await doWork()
} finally {
  hold.dispose() // idempotent
}

// React to the machine suspending/resuming:
this.registerDisposable(power.onSuspend(() => pauseLongPoll()))
this.registerDisposable(power.onResume(() => resumeLongPoll()))

// Run cleanup before the OS shuts the machine down:
this.registerDisposable(power.registerShutdownHandler(() => flushCriticalState()))
```

## Notes

- **WhenReady phase.** The app is already ready, so `powerSaveBlocker` / `BrowserWindow`
  are used directly — no `app.whenReady()` gymnastics. The preference gate is self-read,
  mirroring `TrayService` / `ThemeService` / `ProxyManager`.
- **Sleep prevention is a generic registry.** Any worker that needs the machine awake
  registers a hold; the gate (the user preference) is orthogonal and owned here. The Job
  system is the first registrant; streaming and other workers self-register later through
  the same API.
- **`preventSleep()` is best-effort and never throws.** It always returns a usable
  `Disposable`; any `powerSaveBlocker` failure is logged and swallowed inside the service.
  Consumers therefore need no defensive `try/catch` around acquisition — the graceful
  degradation lives in the provider, not at every call site.
- **OS shutdown is routed through the app's normal quit flow.** On macOS/Linux the barrier
  calls `event.preventDefault()` then `application.quit()` (Windows: `blockShutdown` →
  handlers → `releaseShutdown` → `application.quit()`). Because the quit goes through
  `before-quit`, an active `Application.preventQuit` hold (e.g. a data migration) will gate
  an OS-initiated shutdown just like a user quit — bounded by the hard shutdown-handler
  timeout, since the OS cannot be blocked indefinitely.
- The user-facing toggle lives in Settings → General; the preference is defined in the
  data-classify `target-key-definitions.json` (no v1 source).
