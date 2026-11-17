# Agent Note: Separate keybinding eligibility from command targets

Status: proposed

English | [中文](2026-11-09-command-target-routing.zh.md)

## Problem

A focused component must not implicitly disable commands owned by its active tab or window. Conversely, a visible list must not receive deletion simply because it has registered a handler. Keyboard eligibility and command target selection answer different questions.

On the current main baseline `9985917a436a82debfde647bf25a88f680415cab`, renderer handlers are window-wide. [#23917](https://github.com/CherryHQ/cherry-studio/pull/23917), currently unmerged, introduces focus scopes, explicit interaction boundaries and captured menu origins. Its review repair restores Chat/Agent composer number navigation by registering those handlers through `useTabCommandRuntime`, retaining list activation and ordering guards. This restores behavior but leaves each consumer responsible for choosing a registration runtime.

This Spec partially succeeds #23917's registration and handler-routing decision. Its boundary lifetimes, editable-target protection, menu origin capture and shortcut presentation contracts remain requirements. The Spec is independently reviewable on main; implementation must incorporate the prerequisite once available rather than copying its deletion feature into another PR. No implementation is included here.

## Proposal

### Reference model and ownership

Use VS Code's separation as the reference, rather than describing a component handler chain as its architecture. At [VS Code commit 864824b432e6fb153a3b4dfa1e0f96744ebcf6a4](https://github.com/microsoft/vscode/tree/864824b432e6fb153a3b4dfa1e0f96744ebcf6a4), [ContextKeyService](https://github.com/microsoft/vscode/blob/864824b432e6fb153a3b4dfa1e0f96744ebcf6a4/src/vs/platform/contextkey/browser/contextKeyService.ts) resolves target-local context with parent inheritance; [KeybindingResolver](https://github.com/microsoft/vscode/blob/864824b432e6fb153a3b4dfa1e0f96744ebcf6a4/src/vs/platform/keybinding/common/keybindingResolver.ts) matches ordered rules and their `when` clauses; [CommandService](https://github.com/microsoft/vscode/blob/864824b432e6fb153a3b4dfa1e0f96744ebcf6a4/src/vs/workbench/services/commands/common/commandService.ts) executes a registered command. [Editor navigation](https://github.com/microsoft/vscode/blob/864824b432e6fb153a3b4dfa1e0f96744ebcf6a4/src/vs/workbench/browser/parts/editor/editorActions.ts) obtains the active editor group from its owning service. Scoped context does not require every handler to belong to the focused DOM component.

Cherry retains its existing command IDs, keybinding preferences and expression evaluator. Renderer command contributions declare target semantics centrally; mutable owner registrations remain in the renderer. Existing shared `CommandScope` continues to mean process scope (`main`, `renderer`, `both`), not UI target scope. No renderer service or mutable registry enters `src/shared` or `packages/ui`.

### Eligibility and target selection

Keyboard dispatch reads the event's registered ContextKey scope, including inherited values and event-local editable/IME facts. For each matching binding, `when` checks trigger eligibility and the renderer independently checks for an enabled handler on the declared target. Preserve existing precedence among eligible bindings. A missing, disabled or ambiguous owner makes that command unavailable for the event; it cannot borrow a handler from another owner. Once a candidate is selected, a late refusal does not retry another binding. Adding a component scope must not, by itself, suppress tab/window commands.

Target policies are limited to existing needs: focused owner, active-tab owner and window owner. This is a Cherry adaptation, not a claim that VS Code exposes these three policies. Owners register their business callbacks with the shared renderer command mechanism; the dispatcher selects by declared policy rather than asking every consumer to obtain another runtime. No command-name, route-name or Chat/Agent branch is allowed in the dispatcher. Multiple eligible owners for one command/target are a conflict, not a registration-order election.

| Command family | Keyboard eligibility | Target |
| --- | --- | --- |
| Permanent deletion | Focused eligible resource, outside editable/rename state | Focused list/group/History owner and its focused item |
| Conversation-number navigation | Active tab has a visible, idle conversation source and an existing ordered slot | Conversation navigation owner in the active tab |
| Window commands | Existing feature, platform and command-specific conditions | Current window owner |

Conversation navigation keeps current section collapse filtering and group ordering, missing-slot behavior, loading protection and list activation. Composer focus does not disable it. Target ownership comes from the tab lifecycle, not the currently focused child; hidden or transitioning tabs and inactive panes cannot contribute eligible owners. The target policy does not grant permission through a dialog/menu boundary. Preserve #23917's explicit crossing policy and logical layer priority, including Activity replay.

### Invocation and migration

Resolve one invocation containing command ID, owner identity, handler identity and arguments. Keyboard execution uses that captured handler after matching; synchronous predicates cannot redirect it. Explicit component/programmatic calls and menu actions retain their bound or captured origin instead of being redirected to whichever tab is active later. Explicit execution applies business enablement but not keyboard-only `when`. Delayed menu results recheck owner lifetime, callback identity and business eligibility, and refuse stale origins without retargeting.

Migrate the affected renderer registrations together: conversation-number navigation, the resource-list/group/History deletion families, and existing window search/tab/fullscreen registrations. Inspect other command registrations for dependencies on the previous lookup rule; migrate only consumers whose ownership changes. Remove the consumer-side `useTabCommandRuntime` path and any APIs orphaned by this migration in the same implementation. Do not retain two competing target-selection systems. Update command references and cross-link #23917's note when it is present on the implementation base; preserve its unique rationale and verification history.

Settings, shortcut hints and menu presentation continue to distinguish configured bindings, feature availability, command enablement and keyboard-only conditions. Do not change default shortcuts, preference storage, IPC, main-process/global shortcut ownership, deletion confirmation or database protection. Replacing Radix focus traps and fixing the separately observed nested Activity overlay/pointer restoration issue are outside this proposal.

## Alternatives considered

- Keep consumer-selected runtimes: preserves the current repair but repeats target selection at call sites and makes broader shortcuts vulnerable to component nesting changes.
- Make every command global or whitelist Chat/Agent shortcuts: loses focused destructive-target ownership or encodes business exceptions in the dispatcher.
- Make nearest component or registration order decide every command: conflates context, eligibility and target selection; sibling composers cannot reliably reach tab navigation.
- Copy the entire VS Code command infrastructure: exceeds the required change. Reuse Cherry's registry, conditions and preferences while adopting the separation of responsibilities.

## Acceptance criteria

- AC1 — Adding a nested focused component does not suppress an eligible tab/window command; overlapping keys retain explicit rule ordering and `when` behavior, and an unavailable target never causes its command to consume the key or execute against another owner. (verification: explicit resolver/renderer tests; owner: renderer commands)
- AC2 — In actual Chat and Agent composers, numbered navigation switches only the active tab's ordered visible conversations and preserves drafts; missing slots, collapsed sections, loading sources and inactive panes never navigate to an unintended conversation. (verification: affected consumer tests and bounded Electron scenarios; owner: conversation navigation)
- AC3 — Permanent deletion resolves only the focused eligible list/group/History item; composer input, rename state, protected/missing items, hidden tabs and multiple sibling lists cannot retarget or consume an unrelated deletion. (verification: affected consumer tests and Electron focused-resource scenarios; owner: resource consumers)
- AC4 — Dialog/menu boundaries continue to isolate background commands, preserve permitted window actions and keep logical nested/sibling priority across Activity hide/show; target policy alone cannot bypass a boundary. (verification: real primitive renderer tests and Electron keyboard scenarios; owner: renderer commands/UI adapter)
- AC5 — Keyboard predicates, delayed native menus, focus/tab changes, callback replacement and owner disposal cannot redirect a captured invocation; explicit menus/programmatic calls remain independent of keyboard-only conditions. (verification: command/menu tests and bounded native-popup Electron scenarios; owner: renderer commands)
- AC6 — Settings, hints, rebinding, platform/feature switches, IME and window search/tab/fullscreen behavior retain their contracts; main/global shortcut ownership, IPC and persisted data remain unchanged. (verification: explicit affected renderer/shared/UI tests and scoped type checks; owner: command consumers)
- AC7 — Central target declarations and lifecycle owner registration replace consumer runtime selection; no Chat/Agent dispatch branch, global DOM scan, registration-order target election or legacy tab-runtime path remains, and command references plus bilingual notes describe the implemented behavior. (verification: source/scope inspection and docs gates; owner: renderer commands/documentation)

## Risks

- Choosing the active source in a split or retained pane is a business ownership decision; ambiguous sources must not be resolved by mount order. Implementation must use the existing pane visibility and tab transition facts and demonstrate duplicate-owner refusal.
- Broader eligibility can intercept text editing or background deletion if binding conditions and target activation are conflated. Regression checks must vary focus independently from active tab, source visibility and business eligibility.
- React Activity and delayed native menus separate DOM presence from owner lifetime. Reuse explicit lifetime and invocation identities; do not introduce a second global focus/active-target cache.
- This Spec changes part of an unmerged prerequisite. Reconcile against its actual merged or approved implementation base before coding, retain its boundary guarantees, and obtain current-head Spec approval. Report keyboard, pointer/accessibility, native callback and physical OS interaction evidence separately.
