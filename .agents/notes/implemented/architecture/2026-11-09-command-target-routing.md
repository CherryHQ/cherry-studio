# Agent Note: Separate keybinding eligibility from command targets

Status: implemented

English | [中文](2026-11-09-command-target-routing.zh.md)

## Problem

A focused component must not implicitly disable commands owned by its active tab or window. Conversely, a visible list must not receive deletion simply because it has registered a handler. Keyboard eligibility and command target selection answer different questions.

The [focus-scope prerequisite #23917](https://github.com/CherryHQ/cherry-studio/pull/23917) introduced focus scopes, explicit interaction boundaries and captured menu origins. Its composer-navigation repair registered callbacks through a consumer-selected tab runtime. That restored navigation but left target selection distributed across registration sites.

The approved [Spec #23934](https://github.com/CherryHQ/cherry-studio/pull/23934) is implemented on a main baseline that already includes #23917. This decision partially supersedes its registration and handler routing; the [focus-scope note](2026-11-09-command-focus-scopes.md) retains its distinct boundary, editable-target, presentation and lifecycle rationale and verification history.

## Decision

### Reference model and ownership

VS Code's separation is the reference; Cherry's component handler chain is a local adaptation. At [VS Code commit 864824b432e6fb153a3b4dfa1e0f96744ebcf6a4](https://github.com/microsoft/vscode/tree/864824b432e6fb153a3b4dfa1e0f96744ebcf6a4), [ContextKeyService](https://github.com/microsoft/vscode/blob/864824b432e6fb153a3b4dfa1e0f96744ebcf6a4/src/vs/platform/contextkey/browser/contextKeyService.ts) resolves target-local context with parent inheritance; [KeybindingResolver](https://github.com/microsoft/vscode/blob/864824b432e6fb153a3b4dfa1e0f96744ebcf6a4/src/vs/platform/keybinding/common/keybindingResolver.ts) matches ordered rules and their `when` clauses; [CommandService](https://github.com/microsoft/vscode/blob/864824b432e6fb153a3b4dfa1e0f96744ebcf6a4/src/vs/workbench/services/commands/common/commandService.ts) executes a registered command. [Editor navigation](https://github.com/microsoft/vscode/blob/864824b432e6fb153a3b4dfa1e0f96744ebcf6a4/src/vs/workbench/browser/parts/editor/editorActions.ts) obtains the active editor group from its owning service. Scoped context does not require every handler to belong to the focused DOM component.

Cherry retains its existing command IDs, keybinding preferences and expression evaluator. Command definitions carry static `renderer.target` metadata in the shared catalog; mutable owner registrations remain in the renderer. Existing shared `CommandScope` continues to mean process scope (`main`, `renderer`, `both`), not UI target scope. No renderer service or mutable registry enters `src/shared` or `packages/ui`.

The shared catalog also serves native-menu command validation, shortcut settings and migration. `CommandDefinition` and `RegisteredCommandDefinition` require `renderer.target` for renderer/both scopes and forbid it for main-only commands. The existing command lookup preserves this metadata; the renderer resolves live owners. The [shared-layer exception](../../../../docs/dev/references/architecture/shared-layer.md#112-carve-out-command-execution-metadata) is limited to static command execution descriptions. This replaces the initial renderer-only target map and the original Spec's unchanged-shared-definition constraint, as approved by the maintainer during implementation; command IDs and runtime routing behavior remain unchanged.

### Eligibility and target selection

Keyboard dispatch reads the event's registered ContextKey scope, including inherited values and event-local editable/IME facts. For each matching binding, `when` checks trigger eligibility and the renderer independently checks for an enabled handler on the declared target. Existing precedence among eligible bindings is preserved. A missing, disabled or ambiguous owner makes that command unavailable for the event; it cannot borrow a handler from another owner. Once a candidate is selected, a late refusal does not retry another binding. Adding a component scope must not, by itself, suppress tab/window commands.

Target policies are declared alongside each command in `src/shared/utils/command/definitions.ts` and limited to existing needs: focused owner, active-tab owner and window owner. This is a Cherry adaptation, not a claim that VS Code exposes these three policies. Owners register their business callbacks with the shared renderer command mechanism; the dispatcher selects by declared policy rather than asking every consumer to obtain another runtime. The dispatcher has no command-name, route-name or Chat/Agent branch. Multiple eligible owners for one command/target are a conflict, not a registration-order election.

| Command family | Keyboard eligibility | Target |
| --- | --- | --- |
| Permanent deletion | Focused eligible resource, outside editable/rename state | Focused list/group/History owner and its focused item |
| Conversation-number navigation | Active tab has a visible, idle conversation source and an existing ordered slot | Conversation navigation owner in the active tab |
| Window commands | Existing feature, platform and command-specific conditions | Current window owner |

Conversation navigation keeps current section collapse filtering and group ordering, missing-slot behavior, loading protection and list activation. Composer focus does not disable it. Target ownership comes from the tab lifecycle, not the currently focused child; hidden or transitioning tabs and inactive panes cannot contribute eligible owners. The target policy does not grant permission through a dialog/menu boundary. #23917's explicit crossing policy and logical layer priority remain in force, including Activity replay.

### Invocation and migration

Resolution captures the command ID, owner and handler identity; execution retains its supplied arguments. Keyboard execution uses that captured handler after matching; synchronous predicates cannot redirect it. Explicit component/programmatic calls and menu actions retain their bound or captured origin instead of being redirected to whichever tab is active later. Explicit execution applies business enablement but not keyboard-only `when`. Delayed menu results recheck owner lifetime, callback identity and business eligibility, and refuse stale origins without retargeting.

Conversation-number callbacks now register in their own list scope through the ordinary runtime. `TabRouter` marks its existing scope with `kind="tab"`; the registry selects eligible owners inside that tab, or the sole active tab for keyboard input outside a tab. Explicit calls keep their originating tab. A standalone window without any tab scope uses the window root. Inactive/transitioning tabs never borrow that fallback.

Resource-list/group/History deletion retains focused ownership. Window search, tab navigation/closing and fullscreen exit declare window targets. Other commands retain their focused policy. Multiple eligible registrations are refused for every target, including within one focused scope. Scope lifecycle and registration notifications reach ancestors so sibling command controls refresh when a broader target becomes available or disappears. The consumer-side tab-runtime hook and context are removed; command references describe the shared target mechanism.

Settings, shortcut hints and menu presentation continue to distinguish configured bindings, feature availability, command enablement and keyboard-only conditions. Default shortcuts, preference storage, IPC, main-process/global shortcut ownership, deletion confirmation and database protection are unchanged. Replacing Radix focus traps and fixing the separately observed nested Activity overlay/pointer restoration issue are outside this change.

## Alternatives considered

- Keep consumer-selected runtimes: preserves the current repair but repeats target selection at call sites and makes broader shortcuts vulnerable to component nesting changes.
- Make every command global or whitelist Chat/Agent shortcuts: loses focused destructive-target ownership or encodes business exceptions in the dispatcher.
- Make nearest component or registration order decide every command: conflates context, eligibility and target selection; sibling composers cannot reliably reach tab navigation.
- Maintain a separate target map: duplicates command IDs and requires two edits for each new command, even with exhaustiveness checks.
- Split the catalog by process and generate shared definitions: adds generation and dependency changes to preserve native-menu validation and shortcut consumers without improving this static metadata contract.
- Copy the entire VS Code command infrastructure: exceeds the required change. Reuse Cherry's registry, conditions and preferences while adopting the separation of responsibilities.

## Consequences

- Owners remain responsible for business eligibility and pane visibility. Duplicate active owners fail closed rather than selecting by mount order.
- Keyboard context, business enablement, target policy and interaction boundaries remain separate. Declaring a broader target does not permit crossing a dialog/menu boundary.
- Explicit calls and delayed menus cannot borrow a later active tab or replacement callback. Activity teardown removes registrations and invalidates captured invocations.
- Electron verification uses an isolated development profile. Actual Chat/Agent composers and resource deletion were driven through CDP keyboard input. Native popup selection invoked real Electron MenuItem callbacks through the main inspector; this does not certify physical OS mouse selection. The separate nested Activity overlay/pointer restoration limitation from the prerequisite remains outside this change.

## Verification

- AC1 — `CommandTargetRouting.test.tsx`, `CommandProvider.test.tsx` and shared `keybindings.test.ts` cover nested composer scopes, target conflicts, eligible binding priority, unavailable targets and late predicate refusal without retry.
- AC2 — `useConversationListShortcuts.test.tsx` covers ordering, collapsed groups/sections, missing slots, loading, inactive lists and Activity restoration. Actual Chat and Agent Electron composers switched with Cmd+1/2, retained distinct drafts and ignored missing Cmd+9.
- AC3 — `ResourceListPermanentDelete.test.tsx`, `ResourceListGroupPermanentDelete.test.tsx`, `HistoryRecordList.permanentDelete.test.tsx` and `CommandFocusScope.test.tsx` cover focused/selected identity, editable/rename/protected/missing items and inactive scopes. Electron input focus did not delete; a focused unselected row opened confirmation for that row and cancellation preserved the selected conversation.
- AC4 — Real `CommandFocusLayers.test.tsx` and UI `keyboard-layer.test.tsx` retain dialog/menu isolation, permitted window commands and nested/sibling Activity priority. Electron deletion confirmation blocked background number navigation; global search remained available from the composer.
- AC5 — `CommandMenus.test.tsx`, `CommandTargetRouting.test.tsx` and `CommandProvider.test.tsx` cover captured callbacks, replacement/disposal, tab changes and keyboard-only predicates. An Electron fixture using production `CommandPopupMenu` and real native IPC kept its original owner after focus changed, refused the result after its tab deactivated, and executed explicit actions despite a rejecting keyboard predicate.
- AC6 — CommandControls, CommandContextKeyProvider, useCommandShortcuts, useNumberShortcutHints, command utilities, AppShell, SubWindowAppShell, TabRouter and fullscreen tests cover presentation, rebinding, window behavior and IME alongside renderer type checking. `command.types.test.ts` with main/renderer type checking verifies target/process constraints; native-menu, main-command, shortcut-service and migration tests verify shared catalog consumers. Shared definitions now carry static target metadata; preference schemas and IPC are unchanged.
- AC7 — Explicit-base change scope, source inspection, affected-document review, changed-file lint/formatting, documentation/pairing and Agent Note transition checks verify central target declarations, consumer runtime removal, reference updates and this bilingual partial supersession.
