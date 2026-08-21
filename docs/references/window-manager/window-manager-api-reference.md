---
description: Full WindowManager method tables — open/close/create/destroy, window ops, queries, broadcast, pools, behavior setters
sources:
  - src/main/core/window/WindowManager.ts
  - src/main/core/window/behavior.ts
---

# WindowManager API Reference

Full method reference for `WindowManager`. For conceptual guidance and when-to-use each group, see [Usage Guide](./window-manager-usage.md).

## Open / Create / Close

Two layers: **Consumer** methods are the universal API and should be used by all business code. **Internal** methods are lower-level primitives for defensive assertions or pool-wide shutdown — consumer code should not reach for them. See [Window API layers: consumer vs internal](./window-manager-usage.md#window-api-layers-consumer-vs-internal).

| Method | Layer | Signature | Description |
|--------|-------|-----------|-------------|
| `open` | **Consumer** | `(type: WindowType, args?: OpenWindowArgs) => string` | Lifecycle-aware open: singleton reuse, pool recycle, or fresh create per registry `lifecycle`. Returns window ID. |
| `close` | **Consumer** | `(windowId: string) => boolean` | Lifecycle-aware release: destroys `default` and singleton-without-config windows; hides pooled / singleton-with-retention windows into the warmup state machine (GC destroys per config). Destruction runs through `window.destroy()`, so the native `close` event does **not** fire — see the [`close`-event carve-out](./window-manager-usage.md#window-api-layers-consumer-vs-internal). |
| `create` | Internal | `(type: WindowType, args?: OpenWindowArgs) => string` | Force fresh creation; throws if a singleton of this type already exists. Use only as a defensive assertion — consumer code should use `open()` + `onWindowCreatedByType` instead. |
| `destroy` | Internal | `(windowId: string) => boolean` | Force destroy via `window.destroy()`, which skips the `close` event — and therefore skips the pool's `close` interception, bypassing pool recycling. Non-pooled windows: identical to `close()`. Pooled windows: use `suspendPool(type)` for pool-wide shutdown instead of destroying individual pooled windows. |

## Window Operations

| Method | Signature | Description |
|--------|-----------|-------------|
| `show` | `(windowId: string) => boolean` | Show a window. Does NOT change macOS Dock state — the Dock tracks window existence + per-type override, not visibility (matching native macOS: Cmd+W hiding a window does not remove the app from the Dock). |
| `hide` | `(windowId: string) => boolean` | Hide a window. Does NOT change macOS Dock state — same reason as `show`. If callers want the Dock to disappear too (tray-mode UX), use `wm.behavior.setMacShowInDockByType` BEFORE `hide`. |
| `minimize` | `(windowId: string) => boolean` | Minimize a window. |
| `maximize` | `(windowId: string) => boolean` | Maximize a window. |
| `unmaximize` | `(windowId: string) => boolean` | Unmaximize a window. |
| `isMaximized` | `(windowId: string) => boolean` | Return whether a window is maximized. |
| `setFullScreen` | `(windowId: string, value: boolean) => boolean` | Enter or leave full-screen mode. |
| `isFullScreen` | `(windowId: string) => boolean` | Return whether a window is in full-screen mode. |
| `restore` | `(windowId: string) => boolean` | Restore a minimized window. |
| `focus` | `(windowId: string) => boolean` | Focus a window. |

## Behavior Runtime Setters

These operate on the declarative `behavior` layer per instance and are exposed on `wm.behavior` (a `BehaviorController` instance). See [Platform Configuration → Declarative Behavior Layer](./window-manager-platform.md#declarative-behavior-layer) for field semantics.

| Method | Signature | Description |
|--------|-----------|-------------|
| `wm.behavior.setHideOnBlur` | `(windowId: string, enabled: boolean) => void` | Override the declared `behavior.hideOnBlur` at runtime. `enabled: true` keeps auto-hide on; `enabled: false` suppresses (effectively "pinned"). No-op when the window type does not declare `behavior.hideOnBlur` (no listener to override). Override is cleared on window destroy and on pool `releaseToPool`. |
| `wm.behavior.setAlwaysOnTop` | `(windowId: string, enabled: boolean) => void` | Toggle always-on-top using `level` / `relativeLevel` from `behavior.alwaysOnTop` (single source of truth). When neither is declared, `setAlwaysOnTop(enabled)` is called with no level — matching Electron's default. |
| `wm.behavior.setMacShowInDockByType` | `(type: WindowType, value: boolean) => void` | Override `behavior.macShowInDock` for an entire type at runtime. Use this to express "app is entering / leaving tray mode": `(Main, false)` before `window.hide()` makes the Dock track the transition; `(Main, true)` before `window.show()` lifts the suppression. Keyed by type (not windowId) so it can be set BEFORE the first instance exists (e.g. tray-on-launch path). When multiple window types contribute (e.g. Main + SubWindow), the Dock stays visible as long as any contributing type is alive — `wm.behavior.setMacShowInDockByType(Main, false)` will not hide the Dock if a SubWindow is still present. |

> No WM-level `setVisibleOnAllWorkspaces` is provided: its options differ per call in real usage (e.g. SelectionAction's full-screen show sequence), and WM has no state to maintain. Consumers call `window.setVisibleOnAllWorkspaces(enabled, options)` directly on the `BrowserWindow` instance. See [README → When to Provide a Runtime Setter](./README.md#when-to-provide-a-runtime-setter) for the decision rule.

## Bounds Persistence

Top-level primitives for the declarative `rememberBounds` capability (singleton-only). These are WindowManager methods, **not** part of `wm.behavior`. See [README → Bounds Persistence](./README.md#bounds-persistence).

| Method | Signature | Description |
|--------|-----------|-------------|
| `setRememberBounds` | `(type: WindowType, enabled: boolean) => void` | Runtime toggle for the `rememberBounds` capability, orthogonal to the registry flag. `true` persists position/size on teardown and restores on the next open; `false` stops persisting AND drops the saved record immediately, so the next open uses the registry default. Affects restore on the next open; the live window keeps its geometry. |
| `peekWindowBounds` | `(type: WindowType) => WindowBoundsState \| undefined` | Read a type's saved bounds without restoring them. Lets a consumer apply state WindowManager does not — e.g. MainWindowService re-applies the saved maximized flag on its own show schedule. `undefined` when nothing is saved. |

## Queries

Naming convention: methods with `Info` in the name return serializable `WindowInfo` snapshots (safe across IPC); methods without it return live `BrowserWindow` instances.

| Method | Signature | Description |
|--------|-----------|-------------|
| `getWindow` | `(windowId: string) => BrowserWindow \| undefined` | Get BrowserWindow instance by ID. |
| `getWindowInfo` | `(windowId: string) => WindowInfo \| undefined` | Get serializable window metadata. |
| `getWindowType` | `(windowId: string) => WindowType \| undefined` | Get a window's registered type by ID (O(1); undefined if unknown/closed). |
| `getWindowsByType` | `(type: WindowType) => BrowserWindow[]` | Get all live window instances of a specific type (skips destroyed). |
| `getWindowInfosByType` | `(type: WindowType) => WindowInfo[]` | Get serializable metadata for all windows of a specific type. |
| `getWindowId` | `(window: BrowserWindow) => string \| undefined` | Resolve window ID from BrowserWindow. |
| `getWindowIdByWebContents` | `(wc: WebContents) => string \| undefined` | Resolve window ID from WebContents (e.g., IPC `event.sender`). |
| `count` | `(getter)` | Number of managed windows. |

## Broadcast

These are raw transport primitives used by WindowManager and remaining legacy channels. Product events should normally use `IpcApiService.broadcast` / `broadcastToType`, which adds the typed event name and payload contract.

| Method | Signature | Description |
|--------|-----------|-------------|
| `broadcast` | `(channel: string, ...args: unknown[]) => void` | Send IPC to all managed windows. Skips destroyed windows. |
| `broadcastToType` | `(type: WindowType, channel: string, ...args: unknown[]) => void` | Send IPC to windows of a specific type. |

## Init Data

| Method | Signature | Description |
|--------|-----------|-------------|
| `open<T>` | `(type: WindowType, args?: { initData?: T, options?: Partial<WindowOptions> }) => string` | When `args.initData` is supplied, written atomically to the store before the method returns; also pushed to the renderer as the `window.reused` payload on reuse paths. |
| `create<T>` | `(type: WindowType, args?: { initData?: T, options?: Partial<WindowOptions> }) => string` | Same atomicity as `open`, but never sends `window.reused` (all create paths are fresh creation). |
| `setInitData` | `(windowId: string, data: unknown) => void` | Low-level primitive. Prefer the `open/create` args form in new code. |
| `getInitData` | `(windowId: string) => unknown \| null` | Retrieve initialization data. Cleared on pool release; preserved on singleton hide. |
| `pushInitData<T>` | `(windowId: string, data: T) => boolean` | Push fresh init data to an already-open window. Writes the store and sends `window.reused` in one step. Returns `false` if the window is missing or destroyed. Main-process only. |
| `pushInitDataToType<T>` | `(type: WindowType, data: T) => number` | Same as `pushInitData` but fans out to every live window of the given type. Returns the number of windows that received the event. Does not filter by visibility — idle pooled windows receive the payload too. |

**Timing contract:**

- **Cold start** (fresh creation): `createWindow` writes `initData` to the store synchronously before returning, so any `getInitData` invoke from the renderer (after React mounts) sees the fresh value. The renderer should use the [`useWindowInitData` hook](./window-manager-usage.md#renderer-usewindowinitdata-hook) — it handles the invoke on mount automatically.
- **Reuse** (pool recycle / singleton reopen): `open()` simultaneously writes to the store AND sends `window.reused` with the same payload. The `useWindowInitData` hook updates its state directly from the event payload — no round-trip.
- **No initData** on a reuse call: the event is NOT fired. No "empty Reused" events — the hook therefore never needs a fallback invoke.
- **Live update** (already-open window): call `pushInitData` / `pushInitDataToType` from any main-process service. Both paths reuse the `window.reused` event, so `useWindowInitData` picks up the new payload in-place with no remount — useful for "swap the visible window's context without `close()`+`open()` flicker". Unlike reuse, these methods forbid `undefined` payloads: pushing nothing has no meaningful semantics here.

`webContents.send` is fire-and-forget and does not buffer messages sent before the renderer registers listeners. This is exactly why fresh windows can't use PUSH — they still must PULL via `getInitData` on mount.

## Pool Management

| Method | Signature | Description |
|--------|-----------|-------------|
| `suspendPool` | `(type: WindowType) => number` | Suspend pool: destroy idle windows, disable pool tracking. Returns count destroyed. |
| `resumePool` | `(type: WindowType) => void` | Resume pool: restore lifecycle behavior, trigger eager warmup if configured. |

See [Suspend / Resume](./window-manager-warmup-mechanics.md#suspend--resume) for semantics while suspended.

## Renderer IPC Surface

All methods above are main-process APIs. The renderer has a deliberately narrower IpcApi surface declared in `src/shared/ipc/schemas/window.ts` and implemented by `src/main/ipc/handlers/window.ts`. Caller-window routes derive identity from `IpcContext.senderId`; the renderer never supplies a window id.

| Route/event | Direction | Input/payload | Effect |
|---|---|---|---|
| `window.close` | renderer → main | void | Ask `MainWindowService.requestClose` first, otherwise close the caller through WindowManager. |
| `window.minimize` / `window.maximize` / `window.unmaximize` | renderer → main | void | Operate on the caller window. |
| `window.set_full_screen` | renderer → main | `boolean` | Set full-screen state on the caller window. |
| `window.is_maximized` / `window.is_full_screen` | renderer → main | void | Query caller-window state; returns `false` for an unmanaged sender. |
| `window.get_init_data` | renderer → main | void | Read the caller's stored init data, or `null` for an unmanaged sender. |
| `window.reused` | main → renderer | `unknown` | Directed event sent on reuse/live init-data update. |
| `window.maximized_changed` / `window.fullscreen_changed` | main → renderer | `boolean` | Directed state-change events for the affected window. |

`window.main.*` and `window.sub.*` routes in the same schema are explicit domain operations delegated to `MainWindowService` or `SubWindowService`; they are not generic cross-window targeting. Opening named windows remains a navigation/domain capability rather than part of the caller-window surface.

Use [`useWindowInitData`](./window-manager-usage.md#renderer-usewindowinitdata-hook) for init data. It combines the cold-start `window.get_init_data` request with the `window.reused` subscription.

## Events

Pooled windows traverse a four-stage conceptual lifecycle, but only the endpoints have dedicated events:

```
Created ──▶ [Released ──▶ Recycled ──▶ Released ──▶ ...] ──▶ Destroyed
```

For non-pooled windows, the same two endpoints apply without any intermediate stages.

| Event | Type | Description |
|-------|------|-------------|
| `onWindowCreated` | `Event<ManagedWindow>` | Fires when a new window is created (before content loads). Fresh-path only for pooled windows. |
| `onWindowDestroyed` | `Event<ManagedWindow>` | Fires when a window is truly destroyed (not on pool release). |
| `onWindowCreatedByType(type, listener)` | `(type, listener) => Disposable` | Convenience variant of `onWindowCreated` that filters to a single `WindowType`. Equivalent to `onWindowCreated` + an inline `if (managed.type === type)` guard, but avoids the boilerplate at every call site. Prefer this for single-type subscriptions (the typical consumer case). |
| `onWindowDestroyedByType(type, listener)` | `(type, listener) => Disposable` | Type-filtered counterpart to `onWindowDestroyed`. Same filtering semantics as `onWindowCreatedByType`. |

The intermediate Released and Recycled stages have no dedicated lifecycle events — side effects on `hide` / `close` / `show` should be expressed as declarative [Platform Quirks](./window-manager-platform.md#platform-quirks), and per-session data on recycle is delivered via the `window.reused` IpcApi payload (see [Init Data](#init-data)).

**Usage notes for pooled windows:**

- **Do NOT set `paintWhenInitiallyHidden: false`** on pooled windows — it suppresses the native `ready-to-show` event, breaking the pool's fresh-window auto-show path (`showMode === 'auto'` listens for `ready-to-show`). It is NOT an acceptable workaround for "show only when content ready" — use `showMode: 'manual'` + consumer-driven show for that, or rely on the reuse-path `Reused` payload to ensure the renderer has data before `.show()` is called.
- **macOS focus / hover / always-on-top workarounds** are declarative — see [Platform Quirks](./window-manager-platform.md#platform-quirks).
