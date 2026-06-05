# Command System — Usage

How renderer and main code uses the command system. For the model and
architecture, see [README.md](./README.md).

## Public entry (renderer)

Import from the barrel only:

```ts
import { CommandContextMenu, CommandShortcut, CommandTooltip, useCommandHandler } from '@renderer/commands'
```

Do not import subpaths such as `@renderer/commands/presentation` from business
code. Keeping a narrow public API lets the runtime change without rewriting call
sites.

The renderer domain (`src/renderer/commands/`) is intentionally not under
`components/` — most files are runtime plumbing rather than generic UI. It owns no
business state: business surfaces contribute only the minimal context keys and
handlers they are responsible for.

## Boundaries

- Shared command metadata, keybindings, menu contributions, and context‑expression
  parsing live in `src/shared/commands`.
- Main‑process command execution, native menu creation, and global shortcuts
  belong to main services.
- Renderer business components must **not** parse shortcut preferences, format
  shortcut labels, or resolve menu contributions directly — use the primitives
  below.

## Registering handlers

`CommandProvider` resolves a keypress to a `CommandId`; components supply the
behavior:

```ts
useCommandHandler('topic.create', handleCreateTopic, { enabled: canCreateTopic })
```

For the same command, the most recently mounted **enabled** handler wins; when it
unmounts, the previous enabled handler becomes active again. A command with no
registered handler never resolves (so the keypress falls through untouched).

> **Status: planned.** The dispatcher does **not** yet skip `contenteditable`
> targets — today it only skips IME composition (`event.isComposing`), so a command
> shortcut *does* fire while the user is typing in a rich editor. Suppressing
> shortcuts inside `contenteditable` (and other rich‑editor) targets is a planned
> refinement. When it lands, don't reach for a per‑component keydown listener to
> work around it; if a command genuinely must fire inside an editor, that's a
> context‑key/enablement decision to discuss.

## Context keys

`ContextKeyProvider` is window‑local. Context keys are not persisted and are not
synced across windows. Base keys are provided automatically: `platform`,
`feature.quick_assistant.enabled`, `feature.selection.enabled`.

Business surfaces contribute scoped keys:

```ts
useCommandContextKey('chat.active', true)
```

Allowed renderer keys are defined by `RendererCommandContextKey`; add one only
when an existing command, shortcut, or menu contribution needs it. Scoped keys use
stack semantics — the latest mounted value wins, unmounting restores the previous.
`undefined` unsets a key; `false` and `null` are valid values.

## Menus

Use `CommandContextMenu` for renderer context menus that participate in the
command system:

- Command‑backed items come from `MenuRegistry` in `src/shared/commands`.
- Renderer‑only extra items use `extraItems` / `getExtraItems` (`type: 'item'` for
  actions, `type: 'submenu'` for nested groups).
- Use `shortcutCommand` on an extra item so the menu resolves the platform label
  and user preference; `shortcutLabel` is an escape hatch for non‑command shortcuts.

The same resolved menu model renders through the native adapter or Cherry UI based
on `menu.presentation_mode`. `app.menu` and `tray.menu` always stay native (main
process services).

## Presentation

Use these instead of assembling labels/shortcuts in feature components:

- `CommandShortcut` — standalone shortcut badge
- `CommandTooltip` — tooltip content including the command shortcut
- `CommandButton` — command‑backed button
- `useResolvedCommand` — custom UI needing the command label, enabled state,
  shortcut label, and execute callback

## Adding a command

1. **Declare it** in `src/shared/commands/definitions.ts` — add an entry to
   `COMMAND_DEFINITIONS` (`id`, `titleKey`, `categoryKey`, `scope`, optional
   `keybinding` with a `defaultBinding`, optional `enablement`).
2. **Add its shortcut preference key** `shortcut.<commandId>` through the
   data‑classify pipeline — add an entry to
   `v2-refactor-temp/tools/data-classify/data/target-key-definitions.json`
   (`type: "PreferenceTypes.PreferenceShortcutType"`, `defaultValue:
   { binding, enabled }`), then regenerate:
   ```bash
   cd v2-refactor-temp/tools/data-classify && npm run generate:preferences
   npx biome format --write src/shared/data/preference/preferenceSchemas.ts
   ```
   (Never hand‑edit `preferenceSchemas.ts`.)
3. **Provide a handler.** Renderer‑scope: `useCommandHandler(id, fn)` in the
   owning surface. Main‑scope: add a built‑in handler in
   `CommandService.registerBuiltInHandlers`.
4. **Optional — contribute it to a menu** by adding a `MENU_CONTRIBUTIONS` entry
   in `src/shared/commands/menus.ts` for the relevant `MenuLocation`.

## Tests

Renderer command tests live in `src/renderer/commands/__tests__/`; shared
declarations in `src/shared/commands/__tests__/`; main services in
`src/main/services/__tests__/`.

Prefer targeted checks first:

```bash
pnpm vitest run src/shared/commands src/renderer/commands
pnpm typecheck
```

Run broader suites when the change touches shared command behavior, main menu
services, or cross‑window contracts.
