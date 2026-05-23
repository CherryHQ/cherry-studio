# Renderer Commands

This directory owns the renderer-side command domain. It is intentionally not
under `components/`, because most files here are runtime plumbing rather than
generic UI components.

Use this domain when renderer code needs to:

- register a command handler for a shared `CommandId`
- dispatch command-backed keyboard shortcuts in the current renderer window
- provide window-local context keys for command, shortcut, and menu resolution
- render command-backed menus, tooltips, buttons, or shortcut badges

## Boundaries

- Shared command metadata, keybindings, menu contributions, and context
  expression parsing live in `packages/shared/commands`.
- Main-process command execution, native menu creation, and global shortcuts
  belong to main services.
- Renderer business components should not parse shortcut preferences, format
  shortcut labels, or resolve menu contributions directly.
- This directory should not own business state. Business surfaces provide only
  the minimal context keys and handlers they are responsible for.

## Public Entry

Import from the barrel only:

```ts
import { CommandContextMenu, CommandShortcut, CommandTooltip, useCommandHandler } from '@renderer/commands'
```

Do not import subpaths such as `@renderer/commands/presentation` from business
code. Keeping a narrow public API lets the command runtime change without
rewriting call sites.

## Runtime

`CommandProvider` is the renderer runtime root.

- It installs one window-level `keydown` dispatcher per renderer window.
- It normalizes keyboard events through shared shortcut utilities.
- It resolves the matching command with current shortcut preferences and
  context keys.
- It executes the active handler through the local command handler stack.

Components register executable behavior with:

```ts
useCommandHandler('topic.create', handleCreateTopic, { enabled: canCreateTopic })
```

For the same command, the most recently mounted enabled handler wins. When that
handler unmounts, the previous enabled handler becomes active again.

## Context Keys

`ContextKeyProvider` is window-local. Context keys are not persisted and are not
synced across renderer windows.

Base context keys are provided by the provider:

- `platform`
- `feature.quick_assistant.enabled`
- `feature.selection.enabled`

Business surfaces may contribute scoped keys with:

```ts
useCommandContextKey('chat.active', true)
```

The allowed renderer keys are defined by `RendererCommandContextKey`. Add a key
only when an existing command, shortcut, or menu contribution needs it.

Scoped keys use stack semantics: the latest mounted value wins, and unmounting
restores the previous value. `undefined` unsets a key; `false` and `null` are
valid values.

## Menus

Use `CommandContextMenu` for renderer context menus that should participate in
the command system.

- Command-backed items come from `MenuRegistry` in `packages/shared/commands`.
- Renderer-only extra items use `extraItems` or `getExtraItems`.
- Use `type: 'item'` for renderer-only actions and `type: 'submenu'` for nested
  groups.
- Use `shortcutCommand` for command-backed extra items so the menu resolves the
  platform label and user preference.
- Use `shortcutLabel` only as an escape hatch for non-command shortcuts.

The same resolved menu model can render through the native adapter or Cherry UI
based on `menu.presentation_mode`. `app.menu` and `tray.menu` stay native in
main process services.

## Presentation

Use these APIs instead of assembling labels and shortcuts in feature components:

- `CommandShortcut` for standalone shortcut badges
- `CommandTooltip` for tooltip content with the command shortcut
- `CommandButton` for command-backed buttons
- `useResolvedCommand` when a custom UI needs command label, enabled state,
  shortcut label, and execute callback

Feature components should not call shortcut formatters directly.

## Tests

Renderer command tests live in `__tests__/` next to this domain.

When changing this directory, prefer targeted checks first:

```bash
pnpm vitest run --project renderer src/renderer/src/commands
pnpm typecheck
pnpm lint
pnpm format
```

Run broader suites only when the change touches shared command behavior, main
menu services, or cross-window contracts.
