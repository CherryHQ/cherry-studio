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
- A renderer surface registers behavior with `useCommandHandler` in its nearest
  `CommandFocusScope`. Main-process handlers live in `CommandService` and delegate
  to the service that owns the behavior.
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
| `src/renderer/hooks/command/` | Focus scope registry, handler registration, context keys, resolved command/menu state, and shortcut settings data |
| `src/renderer/utils/command.ts` | Pure renderer display-state and shortcut-label helpers |
| `packages/ui/src/components/primitives/keyboard-layer.tsx` | Generic UI interaction-layer lifecycle adapted to renderer command boundaries |

`CommandContextKeyProvider` and `CommandProvider` are mounted by the main and
subwindow roots. Other renderer windows do not currently host the renderer command
runtime.

## Keybindings and context

`CommandScope` supports `main`, `renderer`, and `both`:

- Renderer bindings are handled by the window-level `CommandProvider`. A command
  resolves only when its declared target has one eligible owner; focus supplies
  the keybinding context independently.
- Non-global main bindings are handled through `before-input-event` on the main
  window and attached webviews.
- Main bindings marked `global: true` are registered with Electron's
  `globalShortcut` and can fire while the app is unfocused.

`enablement` gates the command itself; a keybinding's `when` expression gates that
trigger. Context expressions are evaluated against process-appropriate context:
Preference-backed feature flags in main, and the event scope's local, inherited
and window-root values in the renderer. `CommandFocusScope` is a renderer focus
boundary, distinct from the process-level `CommandScope`.

Each keybinding resolves its `shortcut.<commandId>` Preference and can fall back
to its declared default. Platform-specific defaults and `additionalBindings` come
from the command definition. Settings lists configured bindings and treats rules
with `editable: false` as fixed. A keyboard-only `when` condition does not hide a
configured shortcut from settings or its label from a menu. Platform support,
command enablement and user shortcut enable switches still apply.

## Dispatch flows

### Renderer keyboard

`keydown` → event path's nearest registered focus scope → scoped context and
shortcut normalization → matching command and declared target → captured handler.

Each command in `src/shared/utils/command/definitions.ts` declares its target in
`renderer.target`. Commands with `scope: 'renderer' | 'both'` must provide it;
main-only commands cannot. `findCommandDefinition()` preserves this metadata for
the renderer dispatcher; there is no separately maintained target catalog. Focused commands search the origin's parent chain;
a nearer registration with no enabled handler blocks ancestor fallback. Conversation
number commands select owners in the active tab, even from a nested composer.
Window search, tab switching/closing and fullscreen exit use window owners.
Other registrations retain their focused ownership.

Owners keep callbacks in their lifecycle scopes. More than one eligible registration
for a command/target is ambiguous and leaves the key untouched; mount order never
chooses a winner. Inactive, detached or transitioning owners cannot execute.
`TabRouter` marks tab scopes explicitly; standalone windows use their root when
there is no tab owner. Adding a focus scope does not suppress broader targets.

No-modifier shortcuts are ignored inside input, textarea, select, or inherited
contenteditable surfaces. Modified shortcuts can still resolve, with
`input.focused` available to their `when` conditions. Resource deletion excludes
editable focus. The event is prevented only after one executable candidate and
its event predicate accept it.

Dialogs and menus register keyboard layers through their actual open/close
lifecycle, including focus restoration. Their scope inherits window-root context
rather than the invoking list's context. A layer does not inherit root handlers
unless those handlers opt in with `allowInKeyboardLayer: true`. Its own scoped
commands remain available. Nested layers release independently. Native popups
use the same boundary policy without requiring a DOM node.

Component programmatic calls retain their bound origin and tab; they do not
select a later active tab. Window commands still use their declared window target. They do not apply keyboard-only `when` or event predicates. See
[focus scopes and lifecycle](./command-usage.md#focus-scopes-and-lifecycle) for
surface integration and retained-tab activation.

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
  Renderer adapters retain the invoking scope, target element and renderer
  handler across the asynchronous popup. They refuse a detached/inactive origin,
  a disabled handler or a changed/disposed registration rather than selecting
  whichever list has focus when the popup closes.

The `MenuLocation` type includes reserved locations. A location existing in the
type or in `MENU_CONTRIBUTIONS` does not by itself prove that a product surface
currently consumes it; check call sites before extending it.
