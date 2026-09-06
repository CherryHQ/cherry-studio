---
description: Current command-backed action model across shared definitions, renderer and main handlers, keybindings, and menus
sources:
  - src/shared/types/command.ts
  - src/shared/types/shortcut.ts
  - src/shared/utils/command
  - src/shared/utils/shortcut.ts
  - src/main/services/CommandService.ts
  - src/main/services/ShortcutService.ts
  - src/main/services/AppMenuService.ts
  - src/main/services/nativePopupMenu.ts
  - src/renderer/components/command
  - src/renderer/hooks/command
  - src/renderer/utils/command.ts
---

# Command System

The command system coordinates application actions that need a stable identity
across shortcuts, menus, or command-aware controls. Those actions are registered
as `CommandId`s and dispatched to handlers owned by either the main process or a
renderer window.

This is not a registry of every interaction in the app. Component-local keyboard
behavior such as text editing, list navigation, and closing a transient surface
can remain local. An action belongs in the command system when multiple trigger
surfaces or configurable shortcuts need to invoke the same behavior.

See [Command System — Usage](./command-usage.md) for consumer APIs and the steps
for adding a command.

## Core model

```text
command definition ──┬── optional keybinding ──▶ main or renderer dispatcher
                     ├── optional menu entry ──▶ main or renderer menu adapter
                     └── command-aware UI ─────▶ main or renderer handler
```

- `COMMAND_DEFINITIONS` declares each command's identity, translation keys,
  process scope, optional enablement expression, and optional keybinding.
- `KEYBINDING_RULES` and the registered command/keybinding lookups are derived
  from those definitions.
- A renderer surface registers behavior with `useCommandHandler`. Main-process
  handlers live in `CommandService` and delegate to the service that owns the
  behavior.
- `MENU_CONTRIBUTIONS` is a separate static declaration keyed by `CommandId`.
  Renderer menus can also carry surface-local custom items that do not become
  commands.

The registry is the source of truth for command metadata, but shortcut persistence
also has a generated Preference entry. Every command with a keybinding therefore
has two intentionally different declarations:

| Concern | Owner |
| --- | --- |
| Identity, scope, context rules, platform overrides, additional bindings | `src/shared/utils/command/definitions.ts` |
| Persisted default binding and enabled state | `shortcut.<commandId>` in `src/shared/data/preference/preferenceSchemas.ts` |

The generated Preference schema must stay aligned with the command definition;
see [Adding a command](./command-usage.md#adding-a-command).

## Code layout

The implementation follows the repository's type-by-domain layout instead of a
single `command/` feature directory.

### Shared contracts and logic

| Path | Responsibility |
| --- | --- |
| `src/shared/types/command.ts` | Command, keybinding, context-expression, and menu contracts |
| `src/shared/types/shortcut.ts` | Shared shortcut preference/result types |
| `src/shared/utils/command/definitions.ts` | Command definitions and derived registries |
| `src/shared/utils/command/keybindings.ts` | Effective binding resolution, matching, accelerators, and conflict detection |
| `src/shared/utils/command/menus.ts` | Static menu contributions and pure menu resolution |
| `src/shared/utils/command/contextExpr.ts` | Context-expression parsing/evaluation and `ContextKeyService` |
| `src/shared/utils/shortcut.ts` | Shortcut token normalization, event conversion, and display formatting |

These modules are pure shared code: they import neither Electron nor React.

### Main-process runtime

| Path | Responsibility |
| --- | --- |
| `CommandService.ts` | Main handler registry, enablement checks, execution, and native-popup IPC registration |
| `ShortcutService.ts` | Window-local main shortcuts and OS-global shortcuts, both delegated to `CommandService` |
| `AppMenuService.ts` | macOS application menu; command-backed entries coexist with Electron roles and custom actions |
| `nativePopupMenu.ts` | Validates and renders renderer-supplied native popup models |
| `menu/adapters/nativeMenuAdapter.ts` | Converts resolved command/custom items into Electron menu templates |

### Renderer runtime

| Path | Responsibility |
| --- | --- |
| `src/renderer/components/command/` | Providers, command-aware controls, context menus, and popup menus |
| `src/renderer/hooks/command/` | Handler registration, context keys, resolved command/menu state, and shortcut settings data |
| `src/renderer/utils/command.ts` | Pure renderer display-state and shortcut-label helpers |

`CommandContextKeyProvider` and `CommandProvider` are mounted by the main and
subwindow roots. Other renderer windows do not currently host the renderer command
runtime.

## Keybindings and context

`CommandScope` supports `main`, `renderer`, and `both`:

- Renderer bindings are handled by the window-level `CommandProvider`. A command
  resolves only when an enabled handler is mounted.
- Non-global main bindings are handled through `before-input-event` on the main
  window and attached webviews.
- Main bindings marked `global: true` are registered with Electron's
  `globalShortcut` and can fire while the app is unfocused.

`enablement` gates the command itself; a keybinding's `when` expression gates that
trigger. Context expressions are evaluated against process-appropriate context:
Preference-backed feature flags in main, and a window-local context-key stack in
the renderer.

Each keybinding resolves its `shortcut.<commandId>` Preference and can fall back
to its declared default. Platform-specific defaults and `additionalBindings` come
from the command definition. Settings lists resolved bindings and treats rules
with `editable: false` as fixed.

## Dispatch flows

### Renderer keyboard

`keydown` → `CommandProvider` → shortcut normalization →
`resolveCommandByKeybinding({ scope: 'renderer', canExecuteCommand: hasHandler })`
→ active handler.

No-modifier shortcuts are ignored while an input, textarea, or contenteditable
target has focus. Modified shortcuts can still resolve. The event is prevented
only after an executable command matches.

### Main keyboard

- Window-local: main window or attached webview `before-input-event` →
  `ShortcutService` → `CommandService.execute`.
- Global: Electron `globalShortcut` → `ShortcutService` → the registered main
  handler.

### Menus

- The macOS app menu resolves its command-backed entries from `app.menu`, then
  combines them with Electron roles and custom entries.
- `CommandContextMenu` and `CommandPopupMenu` combine resolved command
  contributions with caller-provided custom items.
- `menu.presentation_mode` selects Cherry or native rendering for eligible
  renderer menus. `app.menu` and `tray.menu` always resolve to native mode.
- For a native popup, main-process commands execute in `CommandService`;
  renderer commands and custom item IDs are returned to the renderer caller.

The `MenuLocation` type includes reserved locations. A location existing in the
type or in `MENU_CONTRIBUTIONS` does not by itself prove that a product surface
currently consumes it; check call sites before extending it.
