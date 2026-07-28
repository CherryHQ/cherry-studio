# WindowManager Reference

This is the main entry point for Cherry Studio's WindowManager documentation. WindowManager is a lifecycle-managed service that creates, tracks, and reuses Electron `BrowserWindow` instances with three lifecycle modes (default / singleton / pooled), IPC broadcast, domain-service event hooks, and elastic pool reuse.

## Quick Navigation

### System Overview (Architecture)

- [Overview](./window-manager-overview.md) — Core types, three lifecycle modes, event timing contract

### Usage Guide (Code Examples)

- [Usage Guide](./window-manager-usage.md) — Quick Start, domain-service integration pattern, consumer-vs-internal API layering, anti-patterns, `useWindowInitData` hook

### Reference Guides

- [Warmup Mechanics](./window-manager-warmup-mechanics.md) — Shared warmup state machine (pooled two-axis model + singleton variant), config matrix, GC timer, suspend/resume, `WindowManager_Reused` IPC
- [Platform Configuration](./window-manager-platform.md) — Static `platformOverrides`, declarative `behavior`, and OS `quirks` (macOS focus / hover / always-on-top)
- [API Reference](./window-manager-api-reference.md) — Full method tables: open/close/create/destroy, window ops, queries, broadcast, init data, pool management, runtime setters, events
- [Migration Guide](./window-manager-migration-guide.md) — Converting direct `BrowserWindow` usage to WindowManager

---

## Configuration Layers (`windowOptions` / `behavior` / `quirks`)

Per-type metadata in `windowRegistry.ts` is split into three layers. Each field belongs to exactly one — choose by **what goes wrong if you misconfigure it**:

| Layer | What it is | Mis-config consequence | Examples |
|---|---|---|---|
| `windowOptions` | Arguments to `new BrowserWindow(...)` — Electron-native constructor options | Electron rejects the build or behaves wrong on construction | `width`, `alwaysOnTop: true`, `frame: false`, `platformOverrides` |
| `behavior` | Cross-platform, non-hacky declarative behavior that Electron's constructor cannot express | WindowManager behavior diverges from intent (e.g. no auto-hide on blur) | `hideOnBlur`, `alwaysOnTop: { level, relativeLevel }`, `visibleOnAllWorkspaces`, `macShowInDock` |
| `quirks` | OS-specific hacks / workarounds applied via monkey-patches | Sub-par UX on the specific OS (focus steal, Dock flicker, level demotion) | `macRestoreFocusOnHide`, `macClearHoverOnHide`, `macReapplyAlwaysOnTop` |

**Naming rule (orthogonal to layering)**: any field that is effective only on one platform carries a `mac` / `win` / `linux` prefix — regardless of layer. `behavior.macShowInDock` is a behavior field but its `mac` prefix signals the platform scope; `quirks.macRestoreFocusOnHide` is a hack with the same prefix.

---

## Bounds Persistence

`rememberBounds` is a per-type metadata flag — a sibling of `showMode` / `lifecycle`, **not** part of the three configuration layers above. When set, WindowManager persists the window's position/size on teardown and restores them on the next open, onto the display it was last on (clamping into that display's work area if a monitor was removed or resized — never resetting to the primary display). It is backed by the main-process persist cache (`window.bounds` key); old geometry is loseable, so there is no migration.

**Singleton-only.** Bounds answer "where does this window reopen?", which has a unique answer only when window identity equals window type — i.e. a single instance. The flag is ignored (with a dev warning) for non-singleton types. Multi-instance types would need a per-instance *content identity* (e.g. a tab id) plus reopen-restore and stale-id GC; that is a documented future extension.

**Maximize stays consumer-side.** The maximized flag is persisted, but re-applying `maximize()` is left to the consumer (read it back via [`peekWindowBounds`](./window-manager-api-reference.md#bounds-persistence)). Geometry is injected declaratively at construction (`x/y/width/height` are `BrowserWindow` constructor options), but Electron has no `maximized` constructor option — so maximize is a post-construction imperative call whose correct timing is coupled to each window's show choreography (e.g. Main defers it to first show when launching to tray). The split: WindowManager owns saving + restoring geometry; the consumer owns re-applying maximize.

**Runtime toggle.** [`wm.setRememberBounds(type, enabled)`](./window-manager-api-reference.md#bounds-persistence) overrides the registry flag at runtime and is orthogonal to it — it can disable a flag-on type or enable a type that declares no flag. Switching it off also drops the saved record immediately, so the next open uses the registry default. Fullscreen is neither persisted nor restored.

---

## WM Does Not Know "Pin"

**Cherry Studio windows do not share a single "pin" concept** — the three pinnable windows each mean something different by it:

| Window | What "pin" toggles |
|---|---|
| QuickAssistant | Suppress blur-auto-hide (`alwaysOnTop` stays true) |
| SelectionAction | Toggle `alwaysOnTop` (no blur auto-hide to suppress) |
| SelectionToolbar | No pin concept (always hide on blur) |

Plus SelectionAction has an independent `auto_close` user preference that drives blur-auto-hide on its own axis — so all four `{hideOnBlur, alwaysOnTop}` quadrants are reachable.

WindowManager therefore **exposes orthogonal primitives, not a `pin` abstraction**. Consumers compose pin semantics in their own service layer:

```typescript
// QuickAssistant (pin = suppress blur-hide only)
wm.behavior.setHideOnBlur(id, !isPinned)

// SelectionAction (pin = toggle alwaysOnTop only)
wm.behavior.setAlwaysOnTop(id, isPinned)

// SelectionAction (auto_close + pin composed in renderer)
wm.behavior.setHideOnBlur(id, isAutoClose && !isPinned)
```

### When to Provide a Runtime Setter

Runtime setters for the declarative behavior layer live on `wm.behavior` (the {@link BehaviorController} instance). WindowManager provides `setHideOnBlur`, `setAlwaysOnTop`, and `setMacShowInDockByType` there but deliberately does **not** provide `setVisibleOnAllWorkspaces`. A `behavior` field deserves a runtime setter only when at least one of:

1. **WM must maintain state** — e.g. `hideOnBlur` needs an override map the blur listener reads; `macShowInDock` needs a per-type override map the Dock predicate reads.
2. **WM can derive parameters from the registry** — e.g. `setAlwaysOnTop` auto-fills `level` / `relativeLevel`.

`visibleOnAllWorkspaces` satisfies neither (no state; options differ per call, as in SelectionAction's full-screen show sequence) — consumers drive it directly on the `BrowserWindow` instance.

**Note on `wm.behavior.setMacShowInDockByType`**: uniquely keyed by window TYPE (not windowId), because Dock visibility is an app-level UI decision — two instances of the same type should contribute identically, and services routinely need to flip the override BEFORE any instance exists (e.g. tray-on-launch calls `wm.behavior.setMacShowInDockByType(Main, false)` before the first `open(Main)`). See [Platform → Declarative Behavior Layer](./window-manager-platform.md#declarative-behavior-layer) for semantics.

### Consumer Decision Guide

| Situation | Do |
|---|---|
| Only want initial state on create | Declare in registry `behavior.*` |
| Single driver, runtime toggle | Use `wm.behavior.setHideOnBlur` / `wm.behavior.setAlwaysOnTop` (or `window.*` if no setter exists) |
| Multiple independent drivers (pin + auto_close) | Compute final target state on the consumer side, then call setters once. **Do NOT** store intermediate state in WM. |
| Call-specific options that differ per call | Drive directly on `BrowserWindow` (e.g. SelectionAction's show sequence) |

### Type Derivation Convention

- When Electron exports a **named type** (e.g. `VisibleOnAllWorkspacesOptions`), import it directly.
- When it exposes only an **inline union** (e.g. the `level` argument on `setAlwaysOnTop`), derive via `Parameters<BrowserWindow['setAlwaysOnTop']>[1]`.
- **Never** re-declare Electron argument unions by hand.
- **Caveat**: if Electron adds method overloads, `Parameters<>` resolves against the last overload only — re-verify after Electron upgrades.

### Electron Edge Cases to Watch

- `setAlwaysOnTop(false, level)`: `level` is **ignored by Electron** when `enabled` is false. Safe, but document the intent at the call site.
- `setVisibleOnAllWorkspaces`: both options (`visibleOnFullScreen`, `skipTransformProcessType`) are `@platform darwin`. Electron silently ignores them elsewhere.
- Linux / KDE Wayland has a "phantom popup" bug with `setVisibleOnAllWorkspaces` — see `MainWindowService.ts` for context. Consumers must guard this platform themselves; WM does not intervene.

---

## Choosing the Right Lifecycle

| Mode | Instances | `open()` behavior | `close()` behavior | Use for |
|---|---|---|---|---|
| `default` | many | fresh create every call | destroys permanently | Windows that appear in parallel (e.g. sub windows) |
| `singleton` | at most one | creates, or shows + focuses the existing one | destroys by default; hides and later destroys when `singletonConfig.retentionTime` is set | Unique windows (main, settings). See Warmup Mechanics → Singleton Variant for `singletonConfig` options. |
| `pooled` | many, reusable | pops an idle window, or creates fresh if empty | returns to the idle pool, or destroys if over cap | Frequently opened windows where creation cost matters (selection actions) |

Full mode semantics and registry examples: [Overview → Three Lifecycle Modes](./window-manager-overview.md#three-lifecycle-modes).

---

## Consumer vs Internal APIs

WindowManager's lifecycle methods are arranged in two layers. **Consumer code should only ever call `open()` and `close()`** — the registry's `lifecycle` declaration tells them how to behave for each window type.

| Layer | Methods | Role |
|---|---|---|
| **Consumer** | `open(type, args?)`, `close(windowId)` | Lifecycle-aware; the only APIs business code should need |
| Internal | `create(type, args?)`, `destroy(windowId)` | Defensive / escape-hatch primitives; prefer `open()` + `onWindowCreatedByType` instead |

Behavioral injection goes through **`onWindowCreated`** (or its type-filtered convenience variant **`onWindowCreatedByType`** for single-type subscriptions) — see [Usage → Injecting behavior](./window-manager-usage.md#injecting-behavior-onwindowcreated-is-the-canonical-hook).

---

## Common Anti-patterns

| Wrong Choice | Why It's Wrong | Correct Choice |
|---|---|---|
| Attaching listeners directly after `wm.open()` returns | Reused windows (singleton reopen, pool recycle) accumulate duplicate listeners; forces you off `open()` onto `create()` | Subscribe to **`onWindowCreatedByType(type, listener)`** |
| Using `wm.create()` in business code | Singleton uniqueness is already guaranteed by registry `lifecycle`; `onWindowCreatedByType` handles "run setup on fresh" | Use `wm.open()` + `onWindowCreatedByType` |
| Using `wm.destroy()` in business code | On non-pooled windows, identical to `close()`. On pooled windows, bypasses pool — rarely desired | Use `wm.close()`; for pool-wide shutdown, use `suspendPool(type)` |
| Attaching `resized` / per-window `closed` listeners at the `open()` call site for a pooled window | Pool recycle does not re-fire `onWindowCreated`, so reused windows miss them or double up on re-open | Attach inside `onWindowCreatedByType` — it fires exactly once per `BrowserWindow` instance |
| Setting `paintWhenInitiallyHidden: false` on a pooled window to "delay show until content is ready" | Suppresses native `ready-to-show`, breaking the fresh-window auto-show path | Use `showMode: 'manual'` + consumer-driven `show()`, or rely on the `Reused` payload to ensure data arrives before `.show()` |

---

## Related Source Code

### Core Infrastructure

- `src/main/core/window/WindowManager.ts` — Service implementation; runtime behavior setters live on `wm.behavior` (see `behavior.ts`)
- `src/main/core/window/behavior.ts` — Initial `applyWindowBehavior` + `BehaviorController` (runtime setters: `setHideOnBlur`, `setAlwaysOnTop`, `setMacShowInDockByType`)
- `src/main/core/window/windowRegistry.ts` — Per-type metadata (lifecycle, pool config, `windowOptions`, `behavior`, `quirks`, platform overrides)
- `src/main/core/window/types.ts` — `WindowType`, `WindowTypeMetadata`, `WindowBehavior`, `WindowQuirks`, `PoolConfig`, `SingletonConfig`, `WarmupMode`, `WarmupState`, `WarmupStateInit`, `ManagedWindow`
- `src/main/core/window/quirks.ts` — macOS method-slot monkey-patches

### Renderer Integration

- [`src/renderer/windows/README.md`](../../../src/renderer/windows/README.md) — Renderer window entry-point convention (`entryPoint.tsx` + `XxxApp.tsx` three-layer structure)
- `src/renderer/hooks/useWindowInitData.ts` — Canonical hook for init data consumption
- `src/shared/IpcChannel.ts` — `WindowManager_*` IPC channel constants
