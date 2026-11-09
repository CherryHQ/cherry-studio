# Agent Note: Command focus scopes

Status: implemented

English | [中文](2026-11-09-command-focus-scopes.zh.md)

## Problem

Renderer command context was a window-wide snapshot, and handlers competed by registration order across unrelated surfaces. Permanent deletion in [#21837](https://github.com/CherryHQ/cherry-studio/pull/21837) compensated with `commandFocus.ts`, scanning global dialog/menu markup and ancestor styles. Adding focus keys alone would still permit matching one list's context and executing another list's handler. Runtime `when` filtering also made keyboard eligibility control whether settings and binding hints were visible.

## Decision

### Scope and dispatch ownership

Renderer owns DOM-attached `CommandFocusScope` instances and their context/handler registrations. The existing shared `CommandScope` still means `main` / `renderer` / `both`; shared expressions and shortcut resolution remain pure. This follows VS Code's [scoped list context](https://github.com/microsoft/vscode/blob/main/src/vs/platform/list/browser/listService.ts) and [event-target resolution](https://github.com/microsoft/vscode/blob/main/src/vs/platform/keybinding/common/abstractKeybindingService.ts).

The scope provider attaches to an existing `rootRef`, without a layout wrapper. `useCommandHandler`, `useCommandContextKey` and component programmatic execution bind to the nearest scope. Keyboard dispatch resolves that scope from the event path, combines its context with allowed parent/root values, and selects one eligible handler before consuming the event. Siblings never compete. A nearer scope that owns a disabled command blocks fallback for that command; unclaimed commands may resolve through its parents. Registrations within one scope retain last-enabled precedence.

Context and handler values are read synchronously; local subscriptions update presentation without a second authoritative focus registry. Input/textarea/select and inherited contenteditable are recognized on the event path, including explicit noneditable islands. `resource.focused && !input.focused` gates permanent-delete keys; target readiness, rename, pinned/busy guards, pending confirmation and actual deletion remain with resource consumers. A selected conversation never substitutes for a missing focused target.

The provider publishes option changes only when the attached element, activation or context values change. Publishing a new version after every React commit creates a feedback loop when a subscriber reports context to an ancestor: that ancestor renders the provider again even though its scope options are equivalent. Newly allocated context objects with equal values therefore do not trigger another publication. Handler and context registrations retain their own notifications.

`TabRouter` supplies explicit tab/transition activation around React Activity. Retained list panes pass their existing `dataEnabled` visibility state to the list scope. Layout cleanup, DOM attachment and activation prevent hidden/disposed owners from executing. The three deletion consumer families share this routing; `commandFocus.ts` and its scan-only tests are removed.

Conversation-number navigation is registered with the owning tab runtime captured by `TabIdProvider` and read through `useTabCommandRuntime`. List ordering, loading, active-tab and list-activation guards still determine eligible slots. This allows Cmd/Ctrl+1–9 from the composer without hoisting permanent deletion out of the list. Outside a tab provider, navigation uses the window owner.

### Interaction boundaries and origins

`packages/ui` exposes `KeyboardLayerProvider` and a generic adapter contract. Dialog, ContextMenu and DropdownMenu own their open state and actual portal DOM root. Renderer adapts layers to command scopes rooted in window context, retaining the originating scope's activation lifetime without inheriting its list eligibility. Radix still owns focus traps and restoration. Boundary cleanup can be deferred through `releaseAfterFocusRestore` until its actual restoration callback; nested cleanup releases only its own lease. Logical owners and stable opening priority are independent of effect registration order, preserving inner and later-opened sibling boundaries across Activity restoration. Controlled and uncontrolled roots use the same resolved open state for content and boundary. Ordinary portals do not become blocking layers.

Renderer root handlers cross a keyboard layer only through explicit `allowInKeyboardLayer`. Window-level search/tab commands and fullscreen handling preserve their existing application policy; fullscreen still respects an already-prevented Escape. Boundary-local commands remain available without admitting background list deletion. Main-process and OS-global shortcut ownership is unchanged.

Native menus register a boundary before asynchronous item preparation or popup IPC. They capture the invoking scope and handler source, refuse inactive/disposed/replaced origins, and release on completion, cancellation, supersession, failure or unmount. Explicit menu execution uses that captured origin instead of whichever surface gains focus later. Business guards are rechecked; captured origin is not permission to delete an ineligible target. Keyboard-only `when` is not an explicit-menu requirement.

### Presentation and preserved contracts

Shortcut settings, labels and accelerators resolve configured bindings independently of transient keyboard `when`, while preserving command enablement, platform/feature availability, user enable switches, defaults and rebinding. Menu state uses its owner scope. `shouldHandleKeyEvent` remains available for predicates requiring the actual event.

The [permanent-deletion guards note](../bug-fix/2026-10-19-permanent-deletion-guards.md) continues to own transactional pin protection. This change does not alter database, busy, cascade, confirmation or default binding semantics. There is no new database migration, IPC route, persistent setting or dependency. Implementation is in #23917, based on the unmerged #21837 prerequisite rather than duplicating its feature in the PR diff.

## Alternatives considered

- Authoritative focus/blur active-scope cache: duplicates browser state and needs reconciliation for removal, blur gaps and restoration. Resolve event ownership directly.
- Scoped ContextKeys with global handler selection: permits context and handler to belong to different lists. Resolve both in one decision.
- Move DOM scanning into the dispatcher or replace it with a MutationObserver: retains inferred overlay/visibility state. Explicit owners publish activation and layer lifetimes.
- Permanent-delete-only event predicates: leave presentation, menu origins and other surfaces without shared ownership. Keep predicates for event-specific rules.
- Rewrite the command framework or Radix focus management: broadens the migration. Reuse existing definitions, expression resolution, Preferences and primitives.

## Consequences

- Portal DOM roots and scope lifetime owners are explicit because React ancestry alone does not define keyboard ownership.
- New retained surfaces must publish activation, and new renderer root commands must explicitly choose whether to run through a keyboard layer.
- An async menu result cannot retarget a newer registration. Replaced handlers or detached owners require opening a fresh menu.
- Electron evidence uses isolated real-module fixtures, production ResourceList and real native popup IPC. Native selection invokes Electron MenuItem callbacks through the main inspector; it does not prove OS mouse interaction or complete Chat/Agent/History workflows.
- Actual Chat/Agent composers preserve drafts while Cmd+1/2 switches conversations; missing Cmd+9 leaves the current conversation. Nested Activity command routing also passes, but the fixture exposes a separate Radix overlay/pointer and aria-hidden restoration limitation; complete pointer/accessibility restoration is not certified.
- The prerequisite remains independently reviewable. Source/CI scope is checked against the actual #21837 head, and this note records behavior rather than claiming a GitHub review Approval.

## Verification

- Regression — `CommandFocusScope.test.tsx` reproduces the update-depth failure with a scope subscriber reporting context to its parent. Equivalent context objects settle without a render error, while changed values still reach the consumer.

- AC1 — `CommandFocusScope.test.tsx` verifies sibling registration order, event-time focus, nested context/handler ownership and disabled-scope fallback barriers; Electron fixture counters verify independent owners.
- AC2 — `ResourceListPermanentDelete.test.tsx`, `ResourceListGroupPermanentDelete.test.tsx`, `HistoryRecordList.permanentDelete.test.tsx` and scope tests cover editable/rename/protected/missing targets and focused-versus-selected identity; production ResourceList Electron fixture preserves input/protected targets.
- AC3 — `CommandFocusLayers.test.tsx` hides/restores real React Activity with an open Dialog and verifies sibling routing plus preserved dialog state; scope lifecycle and TabRouter tests cover inactive/disposed owners, and the Electron retained-tab fixture repeats hide/show.
- AC4 — Real `CommandFocusLayers.test.tsx` and UI `keyboard-layer.test.tsx` exercise nested Dialog/menu isolation, explicit permitted root commands and restoration ordering, nested/sibling Activity replay and controlled ContextMenu transitions; Electron fixtures verify dialog-local routing and background isolation.
- AC5 — `CommandMenus.test.tsx` verifies captured origins, changed/detached registrations and cancel/failure/unmount cleanup; actual native popup IPC and MenuItem callback fixtures verify cancellation, focus changes and detached-origin refusal, subject to the native interaction limit above.
- AC6 — `useCommandShortcuts.test.tsx`, `command.test.ts`, CommandControls and CommandMenus tests verify settings/hints independent of keyboard focus, feature gates, disabled bindings and rebinding; shared keybinding tests cover trigger resolution.
- AC7 — `useConversationListShortcuts.test.tsx` exercises real list frames with Chat/Agent composers, ordering and inactive-list guards; CommandProvider, scoped context, fullscreen and affected consumer tests plus renderer type checking cover live execution and IME/root behavior; dependency inspection keeps renderer state out of shared utilities and UI independent of renderer services.
- AC8 — Consumer tests, explicit change scope and source inspection confirm all three migrations and removal of the old scan; command reference updates and the documentation/pairing/Agent Note transition gates validate the documentation change.
