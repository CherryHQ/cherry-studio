# Renderer Windows

Each subdirectory is one renderer window: an HTML entry, a thin bootstrap, and a providers-root component. All windows follow the same three-layer convention.

## Entry-Point Convention

| Layer | File | Responsibility | Rule |
|---|---|---|---|
| **L1** | `entryPoint.tsx` | Bootstrap: side-effect imports (styles), `await prepareWindow(...)`, `createRoot().render(<XxxApp />)` | Fixed filename. Defines **no** component — only mounts one. |
| **L2** | `XxxApp.tsx` | Providers root (`Provider` / `QueryClientProvider` / `ThemeProvider` …). May hold an inner runtime leaf that composes the window's focused init hooks (locale / custom-CSS / background / fullscreen …) and mounts the popup/toast hosts (`<PopupHost/>` / `<ToastHost/>`) as sibling leaves. | Fixed name `<WindowName>App`, default export, mounted by L1. |
| **L3** | (varies) | The window's actual UI. | Named for what it is — **no forced suffix**. |

`index.html`'s `<script src>` points at the window's `entryPoint.tsx`.

**Why split L1 from L2**: a module that calls `createRoot().render()` at top level is not a React Fast Refresh boundary, so editing it forces a full page reload. Keeping the component in its own `XxxApp.tsx` (a pure-component module) lets UI edits hot-swap; only the rarely-touched `entryPoint.tsx` reloads.

**L3 naming**: L3 is not part of the convention — name it semantically, never with a suffix. Do **not** invent new `...AppShell` names: `AppShell` is a specific shared layout family (`components/layout/AppShell`, `AppShellTabBar`), not a generic content suffix.

## prepareWindow

`prepareWindow.ts` is the shared L1 prologue: `await prepareWindow({ preference: 'all' | [keys] })` initializes i18n and warms the preference cache **before** the first render, so `usePreference` reads saved values on frame one instead of defaults (no theme flash). `main`/`subWindow` warm the full cache (`'all'`, one in-memory IPC fetch); light windows list exactly the keys their first frame reads. `migrationV2` is a preboot special case (own i18n, no preferences) and stays standalone. CSS side-effect imports stay per-entry — `selection/toolbar` deliberately omits `index.css` (fonts / markdown / chat styles) to keep the lightest window minimal.

## Window runtime leaf

Window-level side effects (subscriptions, DOM sync that must live for the window's lifetime) go in a small runtime-leaf component the L2 `XxxApp` mounts **inside the providers but outside every `TabRouter`/`<Activity>`** — a hidden `<Activity>` subtree destroys effects, so anything mounted under a tab would lose its subscription when that tab is backgrounded.

- **Full-chrome windows (main + subWindow)** call `useWindowRuntime()` — the shared window runtime (locale, dayjs, custom CSS, root background, app-path snapshot, fullscreen, topic/agent auto-rename). Its membership rule is strict: a concern belongs there **only** if both windows need it identically. It takes no config and holds no main-only behavior, so it can't hide a per-window difference — the line between it and the retired `useAppInit` grab-bag.
- **Main-only** concerns stay in `MainWindowRuntime`, explicitly outside `useWindowRuntime`: the boot spinner + `init` timer teardown (paired with markup only `main/index.html` creates), `useAppUpdateHandler`, `useStorageMonitorNotification`, `useTopicNamingErrorNotification` (main-window-targeted toasts that must not duplicate across windows).
- **Light windows** (`quickAssistant` / `selection-action` / `selection-toolbar`) don't use `useWindowRuntime` (they render no localized dates, no chrome). They mount `useLanguageSync` + custom CSS only; `selection-toolbar` strips background declarations first (`stripBackgroundCss`). `useLanguageSync` / `useCustomCss` stay their own hooks precisely because the light windows reuse them.

Do **not** fold main-only behavior into `useWindowRuntime` (a per-window difference would need a config flag — the smell), and do not push non-first-frame work into `prepareWindow`.

## Logger Window Source

Each window declares its logger source **declaratively** in its `index.html`, not via a call in `entryPoint.tsx`:

```html
<meta name="logger-window-source" content="mainWindow" />
```

`LoggerService` reads this meta when constructed. The `<meta>` is parsed before any module script runs, so the source is set before any import-time log — no ordering rules in `entryPoint.tsx`, and no per-window `initLogger` side-effect module. When adding a window, add this meta with a unique source string; reusing an existing string would mix the two windows' logs. Documentless contexts (workers) instead call `loggerService.initWindowSource('Worker')`, which overrides the meta-derived value. See [logging guide](../../../docs/guides/logging.md).

## Windows

| Window | L2 root | L3 content |
|---|---|---|
| `main` | `MainApp` | `components/layout/AppShell` (shared) |
| `subWindow` | `SubWindowApp` | `SubWindowAppShell` |
| `quickAssistant` | `QuickAssistantApp` | `HomeWindow` |
| `migrationV2` | `MigrationApp` | in-component (`components/`) |
| `selection/action` | `SelectionActionApp` | `ActionWindow` |
| `selection/toolbar` | `SelectionToolbarApp` | `SelectionToolbar` (reused in settings pages) |

## See also

- [WindowManager reference](../../../docs/references/window-manager/README.md) — main-process lifecycle, pool mechanics, init-data delivery.
- `../hooks/useWindowInitData.ts` — how a window reads its init data.
