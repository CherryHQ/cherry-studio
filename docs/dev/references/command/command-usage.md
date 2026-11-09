---
description: How to consume command UI and hooks, register handlers and context keys, build menus, and add a command
sources:
  - src/shared/utils/command
  - src/renderer/components/command
  - src/renderer/hooks/command
  - src/main/services/CommandService.ts
  - scripts/data-classify/data/target-key-definitions.json
---

# Command System — Usage

This guide covers the public renderer APIs and the files that must change when a
new command is introduced. See [Command System](./README.md) for the runtime model
and process boundaries.

## Renderer imports

UI and hooks have separate category barrels:

```ts
import { CommandContextMenu, CommandFocusScope, CommandPopupMenu, CommandTooltip } from '@renderer/components/command'
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

Handlers register in the nearest focus scope; callers without a local scope use
the window root. Within one scope, the most recently registered enabled handler
runs. A scope with registrations for a command but none enabled blocks fallback
to an ancestor handler. Sibling scopes never compete for the same keypress.
`enabled` accepts a boolean or an event-time getter for current business
eligibility. A command without an eligible handler leaves the keyboard event
unchanged.

The optional `shouldHandleKeyEvent` is a synchronous predicate for deciding whether
a renderer handler accepts a keyboard event. After a trigger resolves to a command,
keyboard dispatch consults the active registration's predicate before calling
`preventDefault()` or executing the handler. Returning `false` skips both, without
falling back to an older registration or another command. Registrations without a
predicate keep the same behavior; programmatic `execute()` never consults it.

Keep the handler with the business surface that owns the behavior. Do not move
business state into the command runtime merely to make the action triggerable.

## Focus scopes and lifecycle

Attach a `CommandFocusScope` to the surface's existing DOM root. The provider adds
no layout element:

```tsx
const rootRef = useRef<HTMLDivElement>(null)

return (
  <CommandFocusScope rootRef={rootRef} active={isActive} context={{ 'resource.focused': true }}>
    <div ref={rootRef}>{children}</div>
  </CommandFocusScope>
)
```

Handlers and context-key hooks must be rendered beneath that provider. On a
keypress, the dispatcher reads the event's composed path, resolves the nearest
registered scope and combines its context with parent and root values. It
matches the shortcut and handler together, then executes that same candidate.
Changing focus does not require a React state update before the next keypress.

The scope provider notifies subscribers when its root element, activation or
context values change. Passing a new context object with the same values does
not publish another version. Handler and context-key registrations notify
subscribers independently. Registry attachment remains stable across ordinary
rerenders, follows root-element replacement, and is released on unmount or
Activity concealment.

The surface owner must pass `active={false}` when keeping hidden content mounted.
`TabRouter` disables its scope for inactive or transitioning tabs; resource-list
consumers forward their `dataEnabled` state to the list frame's `active` prop.
Inactive parents also disable descendant scopes. Detaching or disposing a scope
removes its ability to execute. Do not infer activation by globally scanning
dialog/menu DOM or ancestor styles.

Resource lists, group headers and History rows provide their own focused
resource scopes. They still own the target item, renaming, pinned/busy eligibility
and pending deletion. The command system does not substitute the selected
conversation for a missing focused row. Resource deletion requires
`resource.focused && !input.focused`; the dispatcher derives editable focus from
the event path, including inherited contenteditable and select controls.

Conversation-number navigation belongs to the active tab, not its list's focus
scope. `TabIdProvider` captures that tab's runtime; `useTabCommandRuntime` lets the
list register navigation there while retaining its own ordering, loading and
activation guards. The shortcut therefore works from the composer. Outside a
tab provider, the window runtime is the navigation owner. Permanent deletion
continues to register in the list scope and does not gain tab-wide eligibility.

Shared Dialog, ContextMenu and DropdownMenu primitives expose their lifecycle
through `KeyboardLayerProvider`. `CommandProvider` supplies the renderer adapter;
`packages/ui` has no dependency on renderer command services. Portal layers begin
from the window context instead of inheriting their invoking list's eligibility.
They isolate background commands until focus restoration completes, including
nested close and unmount. Logical layer ownership and opening priority survive
Activity effect replay, so an open inner dialog remains above its parent and the
later-opened sibling retains priority. Controlled menu content and its boundary
use the same resolved open state. A dialog can contain its own resource scope.

Window-root handlers are unavailable inside a keyboard layer unless explicitly
registered with `allowInKeyboardLayer: true`. Opt in only for actions intended to
remain available inside dialogs or menus:

```ts
useCommandHandler('app.search', handleSearch, { allowInKeyboardLayer: true })
```

`useCommandRuntime().execute()` and `useResolvedCommand().execute()` use their
component's bound scope. Calling from the window root does not select a local
list by current or last-known focus. Explicit execution checks handler
eligibility but does not require the keyboard-only `when` expression or
`shouldHandleKeyEvent`.

## Contributing context keys

`CommandContextKeyProvider` supplies these base keys:

- `platform`
- `feature.quick_assistant.enabled`
- `feature.selection.enabled`
- `feature.screenshot.enabled`

`useCommandContextKey` registers a value in the nearest scope:

```ts
useCommandContextKey('chat.active', true)
```

Context keys are non-persistent and stack-based within a scope. The latest
registered value wins; disposing that registration restores the previous value,
or its inherited value if no local registration remains. A child's local value
does not change its siblings. `useCommandContextReader` subscribes to local and
inherited changes for command-aware presentation; keyboard dispatch reads the
current values directly.

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

Native command menus capture the invoking scope, target element and handler
before awaiting a popup result. They register a keyboard boundary while open,
including asynchronous item resolution, and release it on selection,
cancellation, failure or unmount. Returning to another list does not retarget the
menu action. A detached/inactive origin, a disabled handler, or a changed/disposed
registration refuses execution; a newer handler is not a replacement for the
captured action. Surface-local custom callbacks must retain their business target
and recheck its current eligibility.

## Command-aware presentation

- `CommandTooltip` adds the effective shortcut to tooltip content.
- `CommandHint` renders a compact command shortcut hint.
- `useResolvedCommand` exposes translated label, enabled state, shortcut label,
  icon key, and an execute callback for custom UI.

Use these APIs instead of reading shortcut Preferences or formatting bindings in
a business component.

Shortcut settings and hints describe configured bindings rather than whether a
keypress would execute at the current focus. Keyboard-only `when` conditions do
not remove entries or labels while editing or displaying a menu. Platform and
feature availability, command enablement, user enable switches and rebinding
remain separate from focus eligibility. Command and menu enabled states still
resolve against their owning scope and current handler eligibility.

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
   `scripts/data-classify/data/target-key-definitions.json` with
   `type: "PreferenceTypes.PreferenceShortcutType"`, a matching `{ binding,
   enabled }` default, and `status: "classified"`. Regenerate the owned files:

   ```bash
   cd scripts/data-classify
   npm run generate
   ```

   Never edit `src/shared/data/preference/preferenceSchemas.ts` by hand.
4. Register the behavior with `useCommandHandler` in the owning renderer surface,
   or add a main handler in `CommandService` that delegates to the owning service.
5. If an existing menu surface needs the command, add a `MENU_CONTRIBUTIONS`
   entry in `src/shared/utils/command/menus.ts`. Do not add a contribution for a
   reserved location without a current consumer.

## Verification

Run explicit test files for the changed command behavior and affected consumers.
For scoped routing and layer integration:

```bash
pnpm test:renderer \
  src/renderer/components/command/__tests__/CommandFocusScope.test.tsx \
  src/renderer/components/command/__tests__/CommandFocusLayers.test.tsx \
  src/renderer/components/command/__tests__/CommandProvider.test.tsx \
  src/renderer/components/command/__tests__/CommandMenus.test.tsx
```

Add the relevant explicit shared resolver, settings, menu, UI primitive or
main-service test paths when those contracts change. Validate real focus,
retained-tab and native-menu behavior in Electron. For documentation-only edits,
run `pnpm docs:check` instead.
