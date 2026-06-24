# Renderer Windows

Each subdirectory is one renderer window: an HTML entry, a thin bootstrap, and a providers-root component. All windows follow the same three-layer convention.

## Entry-Point Convention

| Layer | File | Responsibility | Rule |
|---|---|---|---|
| **L1** | `entryPoint.tsx` | Bootstrap: side-effect imports (styles, antd React 19 patch), any `await` preload / init-data, `createRoot().render(<XxxApp />)` | Fixed filename. Defines **no** component — only mounts one. |
| **L2** | `XxxApp.tsx` | Providers root (`Provider` / `QueryClientProvider` / `ThemeProvider` / `AntdProvider` …). May hold an inner `XxxContent` for post-Redux hook wiring (e.g. `window.toast`). | Fixed name `<WindowName>App`, default export, mounted by L1. |
| **L3** | (varies) | The window's actual UI. | Named for what it is — **no forced suffix**. |

`index.html`'s `<script src>` points at the window's `entryPoint.tsx`.

**Why split L1 from L2**: a module that calls `createRoot().render()` at top level is not a React Fast Refresh boundary, so editing it forces a full page reload. Keeping the component in its own `XxxApp.tsx` (a pure-component module) lets UI edits hot-swap; only the rarely-touched `entryPoint.tsx` reloads.

**L3 naming**: L3 is not part of the convention — name it semantically, never with a suffix. Do **not** invent new `...AppShell` names: `AppShell` is a specific shared layout family (`components/layout/AppShell`, `AppShellTabBar`), not a generic content suffix.

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
| `settings` | `SettingsApp` | route tree (`@renderer/routeTree.gen`) |
| `subWindow` | `SubWindowApp` | `SubWindowAppShell` |
| `quickAssistant` | `QuickAssistantApp` | `HomeWindow` |
| `migrationV2` | `MigrationApp` | in-component (`components/`) |
| `selection/action` | `SelectionActionApp` | `ActionWindow` |
| `selection/toolbar` | `SelectionToolbarApp` | `SelectionToolbar` (reused in settings pages) |

## See also

- [WindowManager reference](../../../docs/references/window-manager/README.md) — main-process lifecycle, pool mechanics, init-data delivery.
- `../hooks/useWindowInitData.ts` — how a window reads its init data.
