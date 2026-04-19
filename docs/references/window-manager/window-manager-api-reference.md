# WindowManager API Reference

Full method reference for `WindowManager`. For conceptual guidance and when-to-use each group, see [Usage Guide](./window-manager-usage.md).

## Open / Create / Close

Two layers: **Consumer** methods are the universal API and should be used by all business code. **Internal** methods are lower-level primitives for defensive assertions or pool-wide shutdown — consumer code should not reach for them. See [Window API layers: consumer vs internal](./window-manager-usage.md#window-api-layers-consumer-vs-internal).

| Method | Layer | Signature | Description |
|--------|-------|-----------|-------------|
| `open` | **Consumer** | `(type: WindowType, args?: OpenWindowArgs) => string` | Lifecycle-aware open: singleton reuse, pool recycle, or fresh create per registry `lifecycle`. Returns window ID. |
| `close` | **Consumer** | `(windowId: string) => boolean` | Lifecycle-aware release: destroys non-pooled windows, returns pooled windows to the pool (or destroys if over cap / pool suspended). |
| `create` | Internal | `(type: WindowType, args?: OpenWindowArgs) => string` | Force fresh creation; throws if a singleton of this type already exists. Use only as a defensive assertion — consumer code should use `open()` + `onWindowCreatedByType` instead. |
| `destroy` | Internal | `(windowId: string) => boolean` | Force destroy via `window.destroy()`, which skips the `close` event — and therefore skips the pool's `close` interception, bypassing pool recycling. Non-pooled windows: identical to `close()`. Pooled windows: use `suspendPool(type)` for pool-wide shutdown instead of destroying individual pooled windows. |

## Window Operations

| Method | Signature | Description |
|--------|-----------|-------------|
| `show` | `(windowId: string) => boolean` | Show a window. Updates Dock visibility on macOS. |
| `hide` | `(windowId: string) => boolean` | Hide a window. Updates Dock visibility on macOS. |
| `minimize` | `(windowId: string) => boolean` | Minimize a window. |
| `maximize` | `(windowId: string) => boolean` | Toggle maximize/unmaximize. |
| `restore` | `(windowId: string) => boolean` | Restore a minimized window. |
| `focus` | `(windowId: string) => boolean` | Focus a window. |

## Queries

| Method | Signature | Description |
|--------|-----------|-------------|
| `getWindow` | `(windowId: string) => BrowserWindow \| undefined` | Get BrowserWindow instance by ID. |
| `getWindowInfo` | `(windowId: string) => WindowInfo \| undefined` | Get serializable window metadata. |
| `getAllWindows` | `() => ManagedWindow[]` | Get all managed windows. |
| `getWindowsByType` | `(type: WindowType) => WindowInfo[]` | Get all windows of a specific type. |
| `getWindowId` | `(window: BrowserWindow) => string \| undefined` | Resolve window ID from BrowserWindow. |
| `getWindowIdByWebContents` | `(wc: WebContents) => string \| undefined` | Resolve window ID from WebContents (e.g., IPC `event.sender`). |
| `count` | `(getter)` | Number of managed windows. |

## Broadcast

| Method | Signature | Description |
|--------|-----------|-------------|
| `broadcast` | `(channel: string, ...args: unknown[]) => void` | Send IPC to all managed windows. Skips destroyed windows. |
| `broadcastToType` | `(type: WindowType, channel: string, ...args: unknown[]) => void` | Send IPC to windows of a specific type. |

## Init Data

| Method | Signature | Description |
|--------|-----------|-------------|
| `open<T>` | `(type: WindowType, args?: { initData?: T, options?: Partial<WindowOptions> }) => string` | When `args.initData` is supplied, written atomically to the store before the method returns; also pushed to the renderer as the `WindowManager_Reused` payload on reuse paths. |
| `create<T>` | `(type: WindowType, args?: { initData?: T, options?: Partial<WindowOptions> }) => string` | Same atomicity as `open`, but never fires `Reused` (all create paths are fresh creation). |
| `setInitData` | `(windowId: string, data: unknown) => void` | Low-level primitive. Prefer the `open/create` args form in new code. |
| `getInitData` | `(windowId: string) => unknown \| null` | Retrieve initialization data. Cleared on pool release. |

**Timing contract:**

- **Cold start** (fresh creation): `createWindow` writes `initData` to the store synchronously before returning, so any `getInitData` invoke from the renderer (after React mounts) sees the fresh value. The renderer should use the [`useWindowInitData` hook](./window-manager-usage.md#renderer-usewindowinitdata-hook) — it handles the invoke on mount automatically.
- **Reuse** (pool recycle / singleton reopen): `open()` simultaneously writes to the store AND fires `WindowManager_Reused` with the same payload. The `useWindowInitData` hook updates its state directly from the event payload — no round-trip.
- **No initData** on a reuse call: the event is NOT fired. No "empty Reused" events — the hook therefore never needs a fallback invoke.

`webContents.send` is fire-and-forget and does not buffer messages sent before the renderer registers listeners. This is exactly why fresh windows can't use PUSH — they still must PULL via `getInitData` on mount.

## Pool Management

| Method | Signature | Description |
|--------|-----------|-------------|
| `suspendPool` | `(type: WindowType) => number` | Suspend pool: destroy idle windows, disable pool tracking. Returns count destroyed. |
| `resumePool` | `(type: WindowType) => void` | Resume pool: restore lifecycle behavior, trigger eager warmup if configured. |

See [Suspend / Resume](./window-manager-pool-mechanics.md#suspend--resume) for semantics while suspended.

## Title Bar

| Method | Signature | Description |
|--------|-----------|-------------|
| `setTitleBarOverlay` | `(options: TitleBarOverlayOptions) => void` | Update title bar overlay on all windows with overlay configured. |

## Renderer IPC Surface

All methods above are main-process APIs. WindowManager also exposes an IPC surface so the renderer can drive window operations for itself. Channel constants live in `packages/shared/IpcChannel.ts`; handlers are registered in `WindowManager.registerIpcHandlers()`.

Preload only wraps `getInitData` as `window.api.windowManager.getInitData()`. The other channels are invoked directly via `window.electron.ipcRenderer.invoke(IpcChannel.WindowManager_*, ...)`. `WindowManager_Reused` is a push-only channel (main → renderer) — see [Pool Mechanics → `WindowManager_Reused` IPC](./window-manager-pool-mechanics.md#windowmanager_reused-ipc).

| Channel | Direction | Args | Effect |
|---|---|---|---|
| `WindowManager_Open` | renderer → main | `(type, initData?)` | `wm.open(type, { initData })`. Returns window ID. Throws if `type` is not registered. |
| `WindowManager_GetInitData` | renderer → main | — | `wm.getInitData(senderWindowId)`. Returns stored init data or `null`. |
| `WindowManager_Close` | renderer → main | `(type?)` | `wm.close(resolveTargetWindowId(sender, type))`. Returns boolean. |
| `WindowManager_Show` | renderer → main | `(type?)` | `wm.show(...)`. |
| `WindowManager_Hide` | renderer → main | `(type?)` | `wm.hide(...)`. |
| `WindowManager_Minimize` | renderer → main | `(type?)` | `wm.minimize(...)`. |
| `WindowManager_Maximize` | renderer → main | `(type?)` | `wm.maximize(...)`. |
| `WindowManager_Focus` | renderer → main | `(type?)` | `wm.focus(...)`. |
| `WindowManager_Reused` | main → renderer (push) | `(payload)` | Fires on pool recycle or singleton reopen when the caller supplied `initData`. |

**Target resolution for the optional `type` argument** (Close / Show / Hide / Minimize / Maximize / Focus):

- **No `type`**: the target is the sender's own window, resolved via `getWindowIdByWebContents(event.sender)`. This is the common case — a window acting on itself.
- **With `type`**: the target must be a **singleton** — the first (and only) window of that type. `default` and `pooled` lifecycles are **not supported** for cross-window targeting via IPC; the call silently returns `false` and the operation is a no-op.

The bare renderer consumption pattern for `Reused` uses `ipcRenderer.on(IpcChannel.WindowManager_Reused, ...)` — but most renderer code should prefer the [`useWindowInitData` hook](./window-manager-usage.md#renderer-usewindowinitdata-hook), which encapsulates both cold-start `getInitData` invoke and reuse payload delivery.

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

The intermediate Released and Recycled stages have no dedicated events — side effects on `hide` / `close` / `show` should be expressed as declarative [Platform Quirks](./window-manager-platform.md#platform-quirks), and per-session data on recycle is delivered via the `WindowManager_Reused` IPC payload (see [Init Data](#init-data)).

**Usage notes for pooled windows:**

- **Do NOT set `paintWhenInitiallyHidden: false`** on pooled windows — it suppresses the native `ready-to-show` event, breaking the pool's fresh-window auto-show path (`showBehavior === 'auto'` listens for `ready-to-show`). It is NOT an acceptable workaround for "show only when content ready" — use `show: false` + consumer-driven show for that, or rely on the reuse-path `Reused` payload to ensure the renderer has data before `.show()` is called.
- **macOS focus / hover / always-on-top workarounds** are declarative — see [Platform Quirks](./window-manager-platform.md#platform-quirks).
