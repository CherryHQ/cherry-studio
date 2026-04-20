# Window Platform Configuration

WindowManager splits per-window configuration into three orthogonal layers:

- **`windowOptions`** — Electron `BrowserWindow` constructor parameters (including `platformOverrides` for static per-OS differences).
- **`behavior`** — cross-platform declarative WM behavior that Electron's constructor cannot express (blur-auto-hide, `setAlwaysOnTop` level, `setVisibleOnAllWorkspaces` options, Dock visibility). See [README → Configuration Layers](./README.md#configuration-layers-windowoptions--behavior--quirks).
- **`quirks`** — OS-specific hacks / workarounds applied via method-slot monkey-patches around `hide()` / `show()` / `close()`.

Naming rule: any field effective on only one platform carries a `mac` / `win` / `linux` prefix, irrespective of layer (e.g. `behavior.macShowInDock`, `quirks.macRestoreFocusOnHide`).

## OS Quirks

Some OS-specific behaviors are tedious to hand-roll at every call site (e.g. the macOS focus dance around `hide()`). WindowManager ships these as **declarative opt-in flags** under `WindowTypeMetadata.quirks`. When set, the manager transparently monkey-patches the corresponding `BrowserWindow` instance methods so business code continues calling `window.hide()` / `window.show()` as usual.

### Available Quirks

| Quirk | Patches | Behavior |
|---|---|---|
| `macRestoreFocusOnHide: boolean` | `hide()`, `close()` | Before invoking the native method, iterate every visible focusable `BrowserWindow` and `setFocusable(false)`; restore them 50ms later. Prevents other windows from being brought to the front when this one disappears. |
| `macClearHoverOnHide: boolean` | `hide()` | After invoking the native `hide()`, send `webContents.sendInputEvent({ type: 'mouseMove', x: -1, y: -1 })` to clear any residual hover state. |
| `macReapplyAlwaysOnTop: boolean` | `show()`, `showInactive()` | After invoking the native method, call `setAlwaysOnTop(true, level, relativeLevel)` with values read from `behavior.alwaysOnTop` (single source of truth). When `behavior.alwaysOnTop.level` is unset, falls back to `'floating'`. Compensates for macOS level resets between hide/show. |

All quirks are macOS-only: on other platforms the methods are left untouched, and `window.hide === originalHide` (identity preserved).

### Example

```typescript
[WindowType.SelectionToolbar]: {
  type: WindowType.SelectionToolbar,
  lifecycle: 'singleton',
  showMode: 'manual',
  windowOptions: { /* ... */ },
  behavior: {
    hideOnBlur: true,
    alwaysOnTop: { level: 'screen-saver' },  // level lives here, not in quirks
    visibleOnAllWorkspaces: { enabled: true, visibleOnFullScreen: true },
    macShowInDock: false
  },
  quirks: {
    macRestoreFocusOnHide: true,
    macClearHoverOnHide: true,
    macReapplyAlwaysOnTop: true              // boolean switch; reads level from behavior above
  }
}
```

With that in place, `this.toolbarWindow.hide()` from the domain service will:

1. Snapshot every visible focusable window and call `setFocusable(false)` on them.
2. Invoke the native `hide()`.
3. Send the synthetic `mouseMove(-1, -1)` to clear hover.
4. Schedule `setFocusable(true)` restoration for the snapshot after 50ms.

The domain service carries none of this code.

### Implementation Notes

- `w.hide.bind(w)` captures the native method with `this` correctly bound, so Electron's C++ bindings continue to see the real `BrowserWindow`.
- EventEmitter behavior (`.on('hide', ...)`, `.once('close', ...)`) is untouched — the quirks patch only the method slots, not the emitter wiring.
- Quirks run *after* `onWindowCreated` and *after* `applyWindowBehavior` fires. This ordering means the behavior layer's initial setter calls (e.g. first `setAlwaysOnTop(true, level)`) do not trigger the monkey-patched show/showInactive.
- Quirks are applied per-window at creation time; there is no runtime toggle.

## Declarative Behavior Layer

`behavior` captures configuration that's non-hacky, cross-platform, and needed beyond the Electron constructor. WindowManager applies these on window creation via `applyWindowBehavior` (in `src/main/core/window/behavior.ts`).

| Field | Type | What it does |
|---|---|---|
| `hideOnBlur` | `boolean` | Installs a blur listener that calls `window.hide()` (with optional runtime override via `wm.behavior.setHideOnBlur(id, enabled)`). |
| `alwaysOnTop` | `{ level?: AlwaysOnTopLevel, relativeLevel?: number }` | Supplies the `level` / `relativeLevel` to `setAlwaysOnTop` calls — the single source of truth, read by: (1) the initial application after create (when `windowOptions.alwaysOnTop` is `true`), (2) `wm.behavior.setAlwaysOnTop(id, enabled)` runtime calls, (3) the `macReapplyAlwaysOnTop` quirk. |
| `visibleOnAllWorkspaces` | `{ enabled: boolean } & VisibleOnAllWorkspacesOptions` | Runs `window.setVisibleOnAllWorkspaces(enabled, options)` once on create. Windows whose true/false options differ per call should *not* declare this (e.g. SelectionAction) — drive directly on `BrowserWindow` instead. |
| `macShowInDock` | `boolean` | macOS-only default for whether a window of this type CONTRIBUTES to Dock visibility (Dock shown iff any alive window contributes). Existence-based, not visibility-based: hiding a contributing window does NOT hide the Dock (Cmd+W semantics). When omitted, defaults to `true`. `false` is for helper windows (floating panels, menu-bar style overlays) that should never affect the Dock. Runtime override via `wm.behavior.setMacShowInDockByType(type, value)` — set it to `false` before `window.hide()` to enter tray mode, `true` before `window.show()` to leave. No-op on Windows/Linux. |

### Runtime Setters

Runtime setters for the behavior layer live on `wm.behavior` (a `BehaviorController` instance defined in `src/main/core/window/behavior.ts`). Grouping them under this sub-namespace mirrors the three-layer `windowOptions` / `behavior` / `quirks` split at the API surface.

| Setter | Purpose |
|---|---|
| `wm.behavior.setHideOnBlur(id, enabled)` | Override the declared `behavior.hideOnBlur` per instance. Cleared on destroy and on pool `releaseToPool` — pool consumers that need a non-default value must re-apply after `open()` / reuse. No-op when the window does not declare `behavior.hideOnBlur`. |
| `wm.behavior.setAlwaysOnTop(id, enabled)` | Toggle always-on-top using the `level` / `relativeLevel` declared in `behavior.alwaysOnTop`. When neither is declared, calls `setAlwaysOnTop(enabled)` with no level. |
| `wm.behavior.setMacShowInDockByType(type, value)` | Override `behavior.macShowInDock` for an entire window type (not a single instance). Use for app-level tray-mode transitions: `(Main, false)` then `hide()` pulls the Dock icon down; `(Main, true)` then `show()` brings it back. Keyed by type so it can be set BEFORE the first instance exists (tray-on-launch). Multi-window safe: with `Main + DetachedTab` both contributing, a `wm.behavior.setMacShowInDockByType(Main, false)` alone does NOT hide the Dock while any DetachedTab is alive. |

`setVisibleOnAllWorkspaces` intentionally has **no** WM-level setter — consumers call it directly on the `BrowserWindow` when needed. See [README → When to Provide a Runtime Setter](./README.md#when-to-provide-a-runtime-setter).

## Platform Overrides

Static `BrowserWindowConstructorOptions` that differ per OS go in `windowOptions.platformOverrides`. Only the branch matching the current runtime is deep-merged into the final config; unmatched branches are discarded, and the `platformOverrides` field itself is stripped before reaching `new BrowserWindow(...)`.

```typescript
windowOptions: {
  width: 350, height: 43,
  frame: false, transparent: true,
  platformOverrides: {
    mac: { type: 'panel', hiddenInMissionControl: true, acceptFirstMouse: true },
    win: { type: 'toolbar', focusable: false },
    linux: { type: 'toolbar' } // focusable is set at runtime by the domain service
  },
  webPreferences: { /* ... */ }
}
```

Precedence (later wins) when merging inside `mergeWindowOptions`:

1. `baseOptions` (registry `windowOptions`)
2. `baseOptions.platformOverrides[currentPlatform]`
3. Caller-provided `overrides` (via `wm.open(type, { options })`)
4. Caller-provided `overrides.platformOverrides[currentPlatform]`

`webPreferences` is deep-merged in the same order.

## When to Use Which Layer

| Situation | Layer |
|---|---|
| `BrowserWindow` constructor can accept it directly | `windowOptions` |
| Only a subset of OSes need a different static value | `windowOptions.platformOverrides[mac/win/linux]` |
| Cross-platform, non-hacky declarative behavior (auto-hide on blur, initial `setAlwaysOnTop` level, dock visibility, initial `setVisibleOnAllWorkspaces`) | `behavior` |
| OS-specific bug workaround requiring a hide/show/close hook | `quirks` |

The layers are composable: Selection's toolbar uses all three (`windowOptions.platformOverrides` for static per-OS differences, `behavior.hideOnBlur` / `behavior.alwaysOnTop` / `behavior.visibleOnAllWorkspaces` / `behavior.macShowInDock` for declarative behavior, and `quirks.*` for the macOS hide/show hacks).

## Electron Edge Cases

- `setAlwaysOnTop(false, level)` — Electron ignores `level` when `enabled` is false. The WM `wm.behavior.setAlwaysOnTop(id, false)` preserves the registry-declared `level` arg only for signature symmetry; the effect is identical.
- `VisibleOnAllWorkspacesOptions` — both `visibleOnFullScreen` and `skipTransformProcessType` are documented as `@platform darwin` in Electron. They are silently ignored on Windows / Linux.
- **Linux Wayland "phantom popup" bug** — `setVisibleOnAllWorkspaces` can put windows into a broken "floating popup" state on KDE Wayland. See `MainWindowService.ts:573` for context. WM does not intervene; consumers using `behavior.visibleOnAllWorkspaces` on Linux should guard via runtime display-protocol checks if they see the regression.
- **`Parameters<>` type derivation** — `AlwaysOnTopLevel` is derived from `Parameters<BrowserWindow['setAlwaysOnTop']>[1]`. If Electron adds method overloads to `setAlwaysOnTop`, this derivation resolves against the last overload only and may silently narrow. Re-verify after Electron upgrades.
