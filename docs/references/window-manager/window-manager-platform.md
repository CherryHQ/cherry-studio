# Window Platform Configuration

WindowManager provides two complementary mechanisms for OS-specific window behavior:

- **`platformOverrides`** — *static* `BrowserWindowConstructorOptions` that differ per OS. No runtime behavior.
- **`quirks`** — *runtime* method-call hooks applied around `hide()` / `show()` / `close()`. No static options.

The two are composable: a window can declare both.

## Platform Quirks

Some OS-specific behaviors are tedious to hand-roll at every call site (e.g. the macOS focus dance around `hide()`). WindowManager ships these as **declarative opt-in flags** under `WindowTypeMetadata.quirks`. When set, the manager transparently monkey-patches the corresponding `BrowserWindow` instance methods so business code continues calling `window.hide()` / `window.show()` as usual.

### Available Quirks

| Quirk | Patches | Behavior |
|---|---|---|
| `macRestoreFocusOnHide: boolean` | `hide()`, `close()` | Before invoking the native method, iterate every visible focusable `BrowserWindow` and `setFocusable(false)`; restore them 50ms later. Prevents other windows from being brought to the front when this one disappears. |
| `macClearHoverOnHide: boolean` | `hide()` | After invoking the native `hide()`, send `webContents.sendInputEvent({ type: 'mouseMove', x: -1, y: -1 })` to clear any residual hover state. |
| `macReapplyAlwaysOnTop: 'screen-saver' \| 'floating' \| true` | `show()`, `showInactive()` | After invoking the native method, call `setAlwaysOnTop(true, level)` (defaulting to `'floating'` when `true`). Compensates for macOS level resets between hide/show. |

All quirks are macOS-only: on other platforms the methods are left untouched, and `window.hide === originalHide` (identity preserved).

### Example

```typescript
[WindowType.SelectionToolbar]: {
  type: WindowType.SelectionToolbar,
  lifecycle: 'singleton',
  show: false,
  quirks: {
    macRestoreFocusOnHide: true,
    macClearHoverOnHide: true,
    macReapplyAlwaysOnTop: 'screen-saver',
  },
  defaultConfig: { /* ... */ }
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
- Quirks run *after* `onWindowCreated` fires, so domain-service listeners attach before quirk wrappers are in place. Wrappers then compose on top of any pre-existing listeners.
- Quirks are applied per-window at creation time; there is no runtime toggle.

## Platform Overrides

Static `BrowserWindowConstructorOptions` that differ per OS go in `defaultConfig.platformOverrides`. Only the branch matching the current runtime is deep-merged into the final config; unmatched branches are discarded, and the `platformOverrides` field itself is stripped before reaching `new BrowserWindow(...)`.

```typescript
defaultConfig: {
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

Precedence (later wins) when merging inside `mergeWindowConfig`:

1. `baseConfig` (registry `defaultConfig`)
2. `baseConfig.platformOverrides[currentPlatform]`
3. Caller-provided `overrides` (via `wm.open(type, overrides)`)
4. Caller-provided `overrides.platformOverrides[currentPlatform]`

`webPreferences` is deep-merged in the same order.

## When to Use `platformOverrides` vs `quirks`

- **`platformOverrides`** — *static* options you'd otherwise write as `...(isMac ? {...} : {...})` inside `defaultConfig`. No runtime behavior.
- **`quirks`** — *runtime* method-call hooks (hide/show pre/post). No static options.

The two are composable: a window can declare both. Selection's toolbar does — `platformOverrides` configures `type: 'panel'` on macOS, while `quirks` wires up the three macOS hide/show hooks.
