# Agent Note: Command focus scopes

Status: proposed

English | [中文](2026-11-09-command-focus-scopes.zh.md)

## Problem

Renderer command context is currently a window-wide snapshot. `CommandProvider` chooses the last enabled registration for a command across the window. A keyboard event therefore has no shared way to select the context and handler belonging to its actual focused surface.

[PR #21837](https://github.com/CherryHQ/cherry-studio/pull/21837), at `b3acfe59449d76c53a3c47a22c26e0d2a9022fde`, compensates for this gap in `src/renderer/utils/commandFocus.ts`. Permanent deletion checks focus, editable descendants, ancestor visibility and every open dialog/menu through DOM inspection. That feature branch is not part of this Spec's main baseline. Moving its scan into the dispatcher would retain the same ownership problem.

Adding focus keys alone is insufficient: global handler selection could still execute another mounted list. Also, `useCommandShortcuts` currently filters the settings catalog by live `when` expressions, and shortcut hints use runtime keybinding resolution. Focus-dependent conditions could make configured shortcuts disappear from settings or menu labels.

## Proposal

### Ownership and scope model

The precedent is VS Code's [DOM-scoped list context](https://github.com/microsoft/vscode/blob/main/src/vs/platform/list/browser/listService.ts) and [event-target keybinding resolution](https://github.com/microsoft/vscode/blob/main/src/vs/platform/keybinding/common/abstractKeybindingService.ts). Adopt those ownership rules while retaining Cherry's existing command framework.

Add renderer-owned `CommandFocusScope`, distinct from the existing shared `CommandScope` (`main` / `renderer` / `both`). A focus scope owns a registered DOM root, parent relationship, local context values, handler registrations and activation state. The window root supplies application-wide context and handlers. Keep the shared context-expression parser and keybinding resolver independent of DOM, React and mutable renderer state.

Expose a scope provider attached to an existing surface root without adding a layout wrapper. `useCommandHandler` and `useCommandContextKey` bind to the nearest scope; existing callers outside a local scope bind to the window root. Within one scope, retain the current registration precedence. Update registration values and eligibility synchronously for dispatch; React effect publication is not the authority for a focus change followed immediately by a keypress.

Resolve keyboard ownership from the event's composed path or target ancestry at dispatch time. Do not maintain a second authoritative `activeScope` through focus/blur events. Focus notifications may refresh presentation, but cannot replace event-time resolution. Page/tab/list owners deactivate scopes when retained content becomes hidden; detached or inactive scopes cannot receive commands. This migration must cover the retained surfaces used by the affected consumers, without a MutationObserver or computed-style scan as a visibility substitute.

### Dispatch contract

For a keypress, resolve the nearest active scope, combine its local context with the permitted parent/root values, evaluate the existing shortcut rules, and choose one dispatch candidate containing the command, scope and handler. Check eligibility and `shouldHandleKeyEvent` before consuming the event, then execute that same candidate. Do not reselect a handler between matching and execution.

Never search sibling scopes. If a nearer scope owns a command but its target is disabled or missing, do not fall back to a parent/background registration for that command. Unclaimed window-level commands can still resolve at the root subject to their own conditions and active boundary policy. Preserve native input behavior when no command accepts the event. Keep IME suppression, rebinding and existing non-resource shortcuts.

Provide scoped resource-focus and input-focus context. The permanent-delete keyboard condition should require a focused resource target and exclude editable focus. Detect input/textarea/select and inherited contenteditable at the event boundary, within the relevant path. Resource consumers still own the focused item, `aria-activedescendant`, rename state, pinned/busy eligibility, pending confirmation and deletion. Selected conversation state is never a fallback for an absent focused target. Keep `shouldHandleKeyEvent` for predicates requiring the actual keyboard event rather than duplicating ordinary focus conditions there.

### Dialog, menu and portal boundaries

Open dialogs and menus explicitly register keyboard boundaries through their lifecycle. The topmost active boundary limits background command routing even during the interval before focus transfer or restoration. Nested close/unmount releases only the corresponding boundary; repeated cleanup is harmless. Root commands remain available only under an explicit boundary policy, preserving existing allowed application shortcuts without admitting resource deletion from the background.

Portal content registers its actual DOM root and explicit scope parent. Dialog/menu content starts from window context and its own scope, without inheriting the invoking list's focus eligibility through React context. Lists inside a dialog may declare their own resource scope. Ordinary portals do not automatically become blocking boundaries. Use Radix's existing open state, focus management and portal APIs rather than reimplementing focus traps.

`packages/ui` owns a generic interaction-layer lifecycle integration point; renderer adapts it to command scopes. The UI package must not import renderer command services or business command IDs. Integrate shared Dialog, ContextMenu and DropdownMenu surfaces, including imperative dialogs, and the native popup lifecycle in `CommandMenus`. Native menus require explicit boundaries because they have no renderer DOM scope. Registration and teardown must cover controlled/uncontrolled open state, cancellation, failure and unmount without global selectors.

### Keyboard, explicit execution and presentation

Keyboard dispatch uses the event scope and shortcut `when`. Component programmatic execution uses its bound scope; root execution remains root-scoped. Explicit menu execution uses the invoking scope and business target captured when that menu opens, including after an asynchronous native popup. If the origin is detached/inactive or its target is no longer eligible, refuse execution instead of retargeting. Recheck current business guards; capturing an origin does not authorize a stale deletion.

Menu display resolves against its owner scope, and explicit menu actions do not require the keyboard-only focus condition. Keep command enablement and business eligibility separate from shortcut `when`. Shortcut settings and configured binding labels must remain available when a list is unfocused, an input is focused, or a dialog/menu is open. Preserve platform and feature availability, user enable switches, defaults and rebinding. Do not remove all context filtering indiscriminately: runtime focus eligibility must not decide whether an otherwise available shortcut appears in settings.

### Migration and delivery

Implement scope/context/handler resolution together, then integrate boundaries and command presentation. Migrate the ResourceList item, group-header and History deletion consumers from #21837 once those consumers are available on the implementation base. If that PR is still unmerged, declare the exact implementation dependency rather than duplicating or silently importing its feature into this Spec. Remove `commandFocus.ts`, its obsolete focus-only eligibility plumbing and its old tests in the same consumer migration; retain equivalent behavior tests against shared routing and real UI primitives.

Update the command references and affected bilingual notes to describe the final contract. The [permanent-deletion guards note](https://github.com/CherryHQ/cherry-studio/blob/b3acfe59449d76c53a3c47a22c26e0d2a9022fde/.agents/notes/implemented/bug-fix/2026-10-19-permanent-deletion-guards.md) remains the owner of transactional pin protection; this proposal does not supersede database, busy, cascade or confirmation semantics. No database migration, IPC change, new persistent setting, default shortcut change or new dependency is proposed.

This is a documentation-only Spec. Implementation layers require an explicit human Approval on the current Spec PR head and must link their AC coverage. Keep this note proposed until cumulative implementation evidence covers every AC; only then move the complete bilingual triplet to implemented.

## Alternatives considered

- Maintain an authoritative active-scope registry through focus/blur: duplicates browser state and requires reconciliation for focus gaps, node removal and restoration. Resolve actual event ownership instead.
- Add ContextKeys while retaining global last-handler selection: can match one list's context and execute another list's handler. Scope both in one dispatch decision.
- Move the global DOM scan into the command provider, or replace it with a MutationObserver: retains inferred overlay/visibility state and couples routing to arbitrary markup. Use explicit owners and lifecycle boundaries.
- Guard only permanent deletion with `shouldHandleKeyEvent`: leaves context, settings, menu execution and other surface commands without shared ownership. Retain the predicate only for event-specific conditions.
- Rewrite the entire command framework or Radix focus management: broadens the change unnecessarily. Reuse the existing expression resolver, command definitions, Preferences and UI primitives.

## Acceptance criteria

- AC1 — Two mounted lists with the same command execute only the focused list's target regardless of registration order; nested context and handler resolution select the same owner for each keypress. (verification: renderer routing tests; owner: command runtime)
- AC2 — Input, textarea, select, inherited contenteditable, rename, missing focused target and disabled/protected target do not consume the deletion shortcut or execute a parent/sibling/background target; focused and selected items remain distinct. (verification: renderer resource/history consumer tests; owner: resource consumers)
- AC3 — Hidden retained tabs/lists, detached scopes and disposed registrations cannot execute; immediate focus changes and scope disposal affect the next keypress without waiting for a React effect. (verification: renderer lifecycle tests and Electron retained-tab scenarios; owner: scope runtime/surface owners)
- AC4 — Dialogs, menus and nested portal boundaries isolate background resource commands from open through close/focus restoration, while permitted root commands and commands owned inside the boundary still work; nested cleanup does not release an outer boundary. (verification: real UI primitive integration tests and Electron; owner: UI/command integration)
- AC5 — Cherry and native menu actions execute against their captured owner and target after focus changes, or refuse an inactive/missing/ineligible origin; cancellation, popup failure and unmount release their boundary without retargeting. (verification: renderer menu boundary tests and native Electron scenarios; owner: command menus)
- AC6 — Shortcut settings and configured binding hints remain available across focus and overlay changes; platform/feature availability, user enable switches, rebinding, command enablement and keyboard-only when conditions retain their separate meanings. (verification: settings/presentation and shared resolver tests; owner: command presentation)
- AC7 — Existing root/component programmatic commands, IME behavior and non-resource shortcuts retain their documented routing, while renderer scope state stays out of shared pure utilities and UI stays independent of renderer command services. (verification: affected consumer tests, type/dependency checks and Electron; owner: command runtime)
- AC8 — All three permanent-delete consumer families use shared scope routing; commandFocus.ts and its obsolete scan/eligibility path are removed, and the command references plus bilingual decision records match the delivered behavior. (verification: explicit change scope, source scan, focused consumer tests and docs gate; owner: implementation coordinator)

## Risks

- React ancestry and DOM ancestry differ for portals. An inherited invoking-list scope must never become a menu/dialog's keyboard owner.
- A boundary registered only after autofocus or cleared before focus restoration can admit a background delete. Verify open/close ordering against the real primitives and native popup lifecycle.
- Event-time context requires a separate presentation subscription path. Avoid window-wide rerenders on every focus event and do not cache routing decisions in a stale React snapshot.
- Removing runtime filtering from shortcut presentation can expose feature-inapplicable commands unless feature/platform availability is preserved separately.
- #21837 is an unmerged consumer dependency at Spec creation. Runtime work and the final deletion-consumer migration must identify their actual bases; a green documentation gate proves no runtime AC.
