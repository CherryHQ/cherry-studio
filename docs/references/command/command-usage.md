---
description: How to consume command UI and hooks, register handlers and context keys, build menus, and add a command
sources:
  - src/shared/utils/command
  - src/renderer/components/command
  - src/renderer/hooks/command
  - src/main/services/CommandService.ts
  - v2-refactor-temp/tools/data-classify/data/target-key-definitions.json
---

# Command System — Usage

This guide covers the public renderer APIs and the files that must change when a
new command is introduced. See [Command System](./README.md) for the runtime model
and process boundaries.

## Renderer imports

UI and hooks have separate category barrels:

```ts
import { CommandContextMenu, CommandPopupMenu, CommandTooltip } from '@renderer/components/command'
import { useCommandContextKey, useCommandHandler, useResolvedCommand } from '@renderer/hooks/command'
```

Business code should import those barrels, not files such as
`@renderer/components/command/CommandMenus` or
`@renderer/hooks/command/useCommandRuntime`. Shared contracts and pure resolution
logic live under `@shared/types/command` and `@shared/utils/command` respectively.

## Registering renderer handlers

`CommandProvider` resolves a trigger to a `CommandId`; the owning surface supplies
the behavior:

```ts
useCommandHandler('topic.create', handleCreateTopic, { enabled: canCreateTopic })
```

Handlers use stack semantics. For the same command, the most recently mounted
enabled handler runs. When it unmounts, the previous enabled handler becomes
active again. A renderer command without an enabled handler does not resolve, so
its keyboard event falls through unchanged.

Keep the handler with the business surface that owns the behavior. Do not move
business state into the command runtime merely to make the action triggerable.

## Contributing context keys

`CommandContextKeyProvider` supplies these base keys:

- `platform`
- `feature.quick_assistant.enabled`
- `feature.selection.enabled`
- `feature.screenshot.enabled`

`useCommandContextKey` is the window-local extension point:

```ts
useCommandContextKey('chat.active', true)
```

Context keys are window-local, non-persistent, and stack-based. The latest mounted
value wins; unmounting restores the previous value. No production surface currently
registers an additional key; add or consume one only when a current command,
keybinding, or menu contribution needs it.

## Building menus

Use `CommandContextMenu` for right-click surfaces and `CommandPopupMenu` for
click-triggered menus. Both resolve static `MENU_CONTRIBUTIONS` for their
`location` and can append caller-owned `extraItems`.

Custom items are appropriate for surface-local actions that do not need a stable
`CommandId`. They can use:

- `shortcutCommand` to display an existing command's effective shortcut label;
  this does not make the custom item's callback command-backed.
- `shortcutLabel` for a label that is not associated with a command.
- `getExtraItems` when a context menu must resolve items lazily.

The same model renders through Cherry UI or a native popup according to
`menu.presentation_mode`. `app.menu` and `tray.menu` remain native regardless of
that Preference.

## Command-aware presentation

- `CommandTooltip` adds the effective shortcut to tooltip content.
- `CommandHint` renders a compact command shortcut hint.
- `useResolvedCommand` exposes translated label, enabled state, shortcut label,
  icon key, and an execute callback for custom UI.

Use these APIs instead of reading shortcut Preferences or formatting bindings in
a business component.

## Adding a command

Before adding a `CommandId`, confirm that the action needs a shared identity: for
example, it has a configurable shortcut or more than one trigger surface. Keep a
single-surface action local when no cross-surface contract is needed.

1. Add the definition to `src/shared/utils/command/definitions.ts`. Set its `id`,
   `titleKey`, `categoryKey`, and owner-aligned `scope`; add `enablement` or a
   `keybinding` only when required. All current commands are owned by either main
   or renderer; use `both` only for a concrete action with legitimate handlers in
   both processes.
2. Add or reuse the English `titleKey` and `categoryKey` in
   `src/renderer/i18n/locales/en-us.json`. When adding keys, run
   `pnpm i18n:sync` and translate the generated entries in every locale.
3. If the command has a keybinding, add `shortcut.<commandId>` to
   `v2-refactor-temp/tools/data-classify/data/target-key-definitions.json` with
   `type: "PreferenceTypes.PreferenceShortcutType"`, a matching `{ binding,
   enabled }` default, and `status: "classified"`. Regenerate the owned files:

   ```bash
   cd v2-refactor-temp/tools/data-classify
   npm run generate
   ```

   Never edit `src/shared/data/preference/preferenceSchemas.ts` by hand.
4. Register the behavior with `useCommandHandler` in the owning renderer surface,
   or add a main handler in `CommandService` that delegates to the owning service.
5. If an existing menu surface needs the command, add a `MENU_CONTRIBUTIONS`
   entry in `src/shared/utils/command/menus.ts`. Do not add a contribution for a
   reserved location without a current consumer.

## Verification

Command behavior is covered in these directories and service tests:

```bash
pnpm test src/shared/utils/command src/renderer/components/command src/renderer/hooks/command
pnpm test src/main/services/__tests__/CommandService.test.ts \
  src/main/services/__tests__/ShortcutService.test.ts \
  src/main/services/__tests__/AppMenuService.test.ts \
  src/main/services/__tests__/nativePopupMenu.test.ts
pnpm lint
```

For documentation-only edits, run `pnpm docs:check` instead.
