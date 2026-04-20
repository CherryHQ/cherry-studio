# Pool Mechanics

Two-axis pool model, configuration, GC behavior, warmup strategies, suspend/resume, and the `WindowManager_Reused` IPC contract.

For conceptual intro to the `pooled` lifecycle mode, see [Overview → Lifecycle Modes](./window-manager-overview.md#pooled--two-axis-pool-with-active-standby--passive-recycle).

## Two-Axis Model: Standby (Producer) vs Recycle (Consumer)

Each pooled window type has a `PoolState` tracking:

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

## Pool Configuration

| Field | Axis | Dimension | Description |
|-------|------|-----------|-------------|
| `standbySize` | Producer | idle count | Pre-warmed spares, actively maintained via `setImmediate` replenish on `open()`. Not bound by `recycleMaxSize`. |
| `initialSize` | Producer | managed count | Warmup target. Defaults to `max(standbySize, recycleMinSize)`. |
| `recycleMinSize` | Consumer | idle count | Decay floor — idle above this is subject to eviction. Meaningless without `recycleMaxSize`. |
| `recycleMaxSize` | Consumer | managed count | Soft cap on recyclable managed. `close()` destroys when exceeded. `0`/`undefined` disables recycling entirely. |
| `warmup` | Lifecycle | — | `'eager'` = pre-create at `onAllReady()`, `'lazy'` = backfill on first `close()`. Defaults to `'eager'` if `standbySize > 0` or `initialSize > 0`. |
| `decayInterval` | Timing | seconds | Interval between evicting one idle above `max(standbySize, recycleMinSize)`. `0` = no decay. |
| `inactivityTimeout` | Timing | seconds | Seconds of no `open()` before trimming idle down to `standbySize` (standby preserved). `0` = never. |

## `recycleMaxSize` Strategy (Soft Cap)

`recycleMaxSize` is a **soft cap on the recyclable managed count**. When `open()` finds the idle queue empty, it still creates a fresh window even if `managed` is at cap, logging a warning instead of blocking. `create()` always creates a fresh window (never pops from idle) and also logs a warning when `managed.size + inflightCreates > recycleMaxSize`. When a window is returned via `close()` and that same check fails, it is destroyed instead of pooled, recovering capacity without waiting for decay.

**Important:** `standbySize`-maintained windows are **not** counted against `recycleMaxSize`. During bursts, `managed` may temporarily equal `in-use + standbySize`, exceeding `recycleMaxSize`. Subsequent close calls converge it back.

## GC Timer

A single shared `setInterval` (60s) runs two checks per pool type, in priority order:

1. **Inactivity timeout** (checked first): If `now - lastOpenAt > inactivityTimeout`, trim the idle queue down to `standbySize` (destroy the oldest excess). `recycleMinSize` is NOT preserved — prolonged inactivity means the recycle buffer is stale.
2. **Decay** (only when inactivity did not fire): If `idle.length > max(standbySize, recycleMinSize)` and enough time has passed since both the last `open()` and the last decay, destroy one idle window from the front.

The decay floor uses `max(standbySize, recycleMinSize)` so decay can never drop `idle` below `standbySize`. The inactivity trim uses `standbySize` only — an intentional asymmetry expressing that `standbySize` is a permanent availability commitment while `recycleMinSize` is a short-term retention buffer.

The timer is demand-driven: started on first `releaseToPool()` or standby replenish, stopped when no pool has idle windows.

| Setting | Effect |
|---------|--------|
| `decayInterval: 0` | No gradual decay |
| `inactivityTimeout: 0` | No full-trim on inactivity |
| Both 0 | Idle windows beyond `standbySize` are never automatically reclaimed |

## Warmup Strategies

**Eager** (`warmup: 'eager'`, default when `standbySize > 0`): Pre-creates `initialSize` hidden windows during `onAllReady()`, after all domain services have subscribed to `onWindowCreated`. First `open()` is zero-wait.

**Lazy** (`warmup: 'lazy'`, default when neither `standbySize` nor `initialSize` is set): No pre-creation. First `open()` synchronously creates. With `standbySize > 0`, the first open also schedules a standby replenish, so subsequent opens are zero-wait. With `standbySize = 0`, the first `close()` backfills to `initialSize`.

When both `standbySize > 0` and `warmup: 'lazy'` are set, the lazy backfill branch in `releaseToPool` is skipped — standby replenish handles pool maintenance, and running both would double-create.

## Suspend / Resume

`suspendPool(type)` destroys idle windows and sets a `suspended` flag. In-use windows are left alone. While suspended:

- `open()` creates windows with default lifecycle (not pooled)
- `close()` destroys windows immediately (no pool return)
- Native close (user clicks X) proceeds normally
- Warmup and lazy backfill are skipped

`resumePool(type)` clears the flag, resets `lastOpenAt` (to prevent immediate GC), and triggers eager warmup if configured.

Persistence is the caller's responsibility. On restart, the owning service should call `suspendPool()` in its `onInit()` if the pool should remain suspended — this is guaranteed to run before `onAllReady()` (where eager warmup fires).

## `WindowManager_Reused` IPC

When a **re-used** window (pool recycle or singleton reopen) is handed back to a caller and the caller supplied `initData`, the renderer receives `IpcChannel.WindowManager_Reused` with that init data as the event payload:

```typescript
window.electron?.ipcRenderer.on(IpcChannel.WindowManager_Reused, (_event, payload) => {
  // payload is exactly the object passed as `open({ initData })`
})
```

Rules:

- Fired only when the window is being **re-used** AND the caller provided `initData`. Fresh windows never receive this event (the renderer is not yet ready to listen — use cold-start `getInitData` instead).
- No "empty" Reused events. No `initData` → no event.
- The same payload is simultaneously written into the init-data store, so `getInitData(windowId)` reflects the new value synchronously once `open()` returns.
- When a reuse `open()` is called **without** `initData`, any previously stored init data for that window is **cleared** from the store — this prevents the renderer from later reading a stale payload left over from an earlier `open()` on the same singleton or pooled instance.

**Recommended usage** in the renderer: don't handle these two paths by hand — use the [`useWindowInitData` hook](./window-manager-usage.md#renderer-usewindowinitdata-hook), which encapsulates both cold-start invoke and re-use payload delivery into a single React hook.

## Avoiding First-Paint Flashes on Reuse

Pooled windows that are **visually sensitive** to showing stale content or empty chrome (e.g. transparent hiddenInset frames on macOS where empty content reveals the native traffic-light buttons) can wrap their own `.show()` call in a short "reveal" sequence that briefly `setOpacity(0) + showInactive()` lets Chromium resume compositor paint, then `setOpacity(1)` after a settle window. See `SelectionService.processAction` for a reference implementation. This concern is domain-specific and not part of the generic `WindowManager` contract.
