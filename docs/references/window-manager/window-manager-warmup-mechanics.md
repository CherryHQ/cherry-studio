---
description: Warmup state machine for pooled and singleton windows — idle queue, GC ticks, standby vs recycle axes, reuse IPC
sources:
  - src/main/core/window/WindowManager.ts
  - src/main/core/window/windowRegistry.ts
---

# Warmup Mechanics

Shared warmup state machine for singleton and pooled lifecycles: idle queue, GC ticks, warmup strategies, and the `window.reused` IpcApi contract.

For conceptual intro to the `pooled` lifecycle mode, see [Overview → Lifecycle Modes](./window-manager-overview.md#pooled--two-axis-pool-with-active-standby--passive-recycle).

## Lifecycle Applicability

| Concept / Field | pooled | singleton |
|---|---|---|
| `warmup: 'eager' \| 'lazy'` | ✓ | ✓ |
| `standbySize` / `initialSize` / `recycleMinSize` / `recycleMaxSize` / `decayInterval` | ✓ | — |
| `inactivityTimeout` | ✓ | — |
| `retentionTime` | — | ✓ |
| Idle queue + `lastActivityAt` + GC tick | ✓ (multi-slot) | ✓ (0 or 1 slot) |
| `close()` interception | always (when pool config present) | only when `retentionTime !== undefined` |
| Reuse resets state | yes (geometry / behavior override / initData) | no (hide→show preserves) |

## Two-Axis Model: Standby (Producer) vs Recycle (Consumer)

Applies to pooled lifecycle only. For singleton, see [Singleton Variant](#singleton-variant).

Each pooled window type has a `WarmupState` tracking:

- **`managed: Set<string>`** — All window IDs belonging to this pool (in-use + idle).
- **`idle: string[]`** — FIFO queue of windows available for reuse.
- **`inflightCreates: number`** — Standby replenishments scheduled via `setImmediate` but not yet executed.

The invariant `idle ⊆ managed` holds throughout. A window enters `managed` on creation, enters `idle` on `close()` (if recycled), leaves `idle` on `open()` recycle, and leaves both on destruction (via the centralized `closed` event listener).

**Four configuration scenarios:**

| Scenario | `standbySize` | `recycleMinSize` | `recycleMaxSize` | Semantics |
|---|---|---|---|---|
| ① | 0 | 0 | 0 | Per-open sync create, close destroys (≈ `default` lifecycle) |
| ② | `K` | 0 | 0 | **Pure pre-warm queue** — always K spares, close destroys (one-shot) |
| ③ | 0 | `N` | `M` | Pure recycle pool — reuse on close |
| ④ | `K` | `N` | `M` | Hybrid — pre-warm + recycle together |

## Pool Configuration (pooled only)

| Field | Axis | Dimension | Description |
|-------|------|-----------|-------------|
| `standbySize` | Producer | idle count | Pre-warmed spares, actively maintained via `setImmediate` replenish on `open()`. Not bound by `recycleMaxSize`. |
| `initialSize` | Producer | managed count | Warmup target. Defaults to `max(standbySize, recycleMinSize)`. |
| `recycleMinSize` | Consumer | idle count | Decay floor — idle above this is subject to eviction. Meaningless without `recycleMaxSize`. |
| `recycleMaxSize` | Consumer | managed count | Soft cap on recyclable managed. `close()` destroys when exceeded. `0`/`undefined` disables recycling entirely. |
| `warmup` | Lifecycle | — | `'eager'` = pre-create at `onAllReady()`, `'lazy'` = backfill on first `close()`. Defaults to `'eager'` if `standbySize > 0` or `initialSize > 0`. |
| `decayInterval` | Timing | seconds | Interval between evicting one idle above `max(standbySize, recycleMinSize)`. `0` = no decay. |
| `inactivityTimeout` | Timing | seconds | Seconds of no `open()` / `close()` activity before trimming idle down to `standbySize` (standby preserved). `0` = never. |

## `recycleMaxSize` Strategy (Soft Cap)

`recycleMaxSize` is a **soft cap on the recyclable managed count**. When `open()` finds the idle queue empty, it still creates a fresh window even if `managed` is at cap, logging a warning instead of blocking. `create()` always creates a fresh window (never pops from idle) and also logs a warning when `managed.size + inflightCreates > recycleMaxSize`. When a window is returned via `close()` and that same check fails, it is destroyed instead of pooled, recovering capacity without waiting for decay.

**Important:** `standbySize`-maintained windows are **not** counted against `recycleMaxSize`. During bursts, `managed` may temporarily equal `in-use + standbySize`, exceeding `recycleMaxSize`. Subsequent close calls converge it back.

## GC Timer

A single shared `setInterval` (60s) runs two checks per tracked type, in priority order:

1. **Inactivity timeout** (checked first): If `now - lastActivityAt > inactivityTimeout`, trim the idle queue down to `standbyFloor` (destroy the oldest excess). `recycleMinSize` is NOT preserved — prolonged inactivity means the recycle buffer is stale.
2. **Decay** (only when inactivity did not fire): If `idle.length > max(standbySize, recycleMinSize)` and enough time has passed since both the last activity and the last decay, destroy one idle window from the front.

`lastActivityAt` is updated on every `open()` and every `close()` — the timer resets at both ends of a usage cycle, so a window held open for long then closed does not immediately satisfy the inactivity threshold.

The decay floor uses `max(standbySize, recycleMinSize)` so decay can never drop `idle` below `standbySize`. The inactivity trim uses `standbySize` only — an intentional asymmetry expressing that `standbySize` is a permanent availability commitment while `recycleMinSize` is a short-term retention buffer.

The timer is demand-driven: started on first `releaseToPool()` / `releaseSingletonToHidden()` or standby replenish, stopped when no tracked type has idle windows.

| Setting | Effect |
|---------|--------|
| `decayInterval: 0` | No gradual decay |
| `inactivityTimeout: 0` | No full-trim on inactivity |
| Both 0 | Idle windows beyond `standbySize` are never automatically reclaimed |

## Warmup Strategies

**Eager** (`warmup: 'eager'`, default when `standbySize > 0`): Pre-creates `initialSize` hidden windows during `onAllReady()`, after all domain services have subscribed to `onWindowCreated`. First `open()` is zero-wait.

**Lazy** (`warmup: 'lazy'`, default when neither `standbySize` nor `initialSize` is set): No pre-creation. First `open()` synchronously creates. With `standbySize > 0`, the first open also schedules a standby replenish, so subsequent opens are zero-wait. With `standbySize = 0`, the first `close()` backfills to `initialSize`.

When both `standbySize > 0` and `warmup: 'lazy'` are set, the lazy backfill branch in `releaseToPool` is skipped — standby replenish handles pool maintenance, and running both would double-create.

For singleton, `eager` pre-creates exactly one hidden instance; `lazy` defers until the first `open()`.

## Singleton Variant

`singletonConfig` enables warmup and delayed destroy on singleton windows.

| Config | `standbyFloor` | `inactivityTimeoutMs` | close behavior | cleanup |
|---|---|---|---|---|
| `{}` | 0 | 0 | destroy (not intercepted) | n/a |
| `{ warmup: 'eager' }` | 1 | 0 | destroy (not intercepted) | none (gcDisabled) |
| `{ retentionTime: N }` (N > 0) | 0 | N · 1000 | hide (intercepted) | trim to 0 after N seconds of inactivity |
| `{ retentionTime: -1 }` | 1 | 0 | hide (intercepted) | never (permanent hidden instance) |
| `{ warmup: 'eager', retentionTime: N }` (N > 0) | 1 | N · 1000 | hide | trim to 1 — preserves standby |
| `{ warmup: 'eager', retentionTime: -1 }` | 1 | 0 | hide | never |

**Close interception trigger**: `retentionTime !== undefined`. Without it, close proceeds natively and the window is destroyed.

**State preservation across hide→show**:

- Geometry preserved (no `resetPooledWindowGeometry`)
- Behavior override preserved (no `clearForWindow`)
- `initDataStore` entry preserved (hide does not delete; next `open()` overwrites when new `initData` is supplied, left intact otherwise — singleton is single-consumer)
- Renderer process intact — `BrowserWindow.hide()` does not destroy it, DOM / React state kept in memory

**Retention clock**: `retentionTime` is measured from the last `open()` OR `close()` (whichever is later). A re-open within the window resets the clock. GC tick precision is ±60 s (`WARMUP_GC_INTERVAL`).

## Suspend / Resume

`suspendPool(type)` destroys idle windows and sets a `suspended` flag. In-use windows are left alone. While suspended:

- `open()` creates windows with default lifecycle (not pooled)
- `close()` destroys windows immediately (no pool return)
- Native close (user clicks X) proceeds normally
- Warmup and lazy backfill are skipped

`resumePool(type)` clears the flag, resets `lastActivityAt` (to prevent immediate GC), and triggers eager warmup if configured.

Persistence is the caller's responsibility. On restart, the owning service should call `suspendPool()` in its `onInit()` if the pool should remain suspended — this is guaranteed to run before `onAllReady()` (where eager warmup fires).

## `window.reused` event

When a **re-used** window (pool recycle or singleton reopen) is handed back to a caller and the caller supplied `initData`, the renderer receives the typed `window.reused` IpcApi event with that init data as the payload:

```typescript
useIpcOn('window.reused', (payload) => {
  // payload is exactly the object passed as `open({ initData })`
})
```

Rules:

- Fired only when the window is being **re-used** AND the caller provided `initData`. Fresh windows never receive this event (the renderer is not yet ready to listen — use cold-start `getInitData` instead).
- No "empty" Reused events. No `initData` → no event.
- The same payload is simultaneously written into the init-data store, so `getInitData(windowId)` reflects the new value synchronously once `open()` returns.
- For **pooled** reuse `open()` without `initData`, the previously stored init data for that window is **cleared** from the store — pool windows are multi-consumer, so stale payload leakage would be a foot-gun.
- For **singleton** hide→show reuse without new `initData`, the store entry is **preserved** — singleton is single-consumer, so "still the same session" means the renderer may legitimately want the last payload back (e.g. via `window.get_init_data` after a devtools reload during hide). The event still does not fire unless the caller passes new `initData`.

**Recommended usage** in the renderer: don't handle these two paths by hand — use the [`useWindowInitData` hook](./window-manager-usage.md#renderer-usewindowinitdata-hook), which encapsulates both cold-start invoke and re-use payload delivery into a single React hook.

## Avoiding First-Paint Flashes on Reuse

Pooled windows that are **visually sensitive** to showing stale content or empty chrome (e.g. transparent hiddenInset frames on macOS where empty content reveals the native traffic-light buttons) can wrap their own `.show()` call in a short "reveal" sequence that briefly `setOpacity(0) + showInactive()` lets Chromium resume compositor paint, then `setOpacity(1)` after a settle window. See `SelectionService.processAction` for a reference implementation. This concern is domain-specific and not part of the generic `WindowManager` contract.
