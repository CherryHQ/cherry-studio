# Recycle Bin UI Polish

## Status

Design decisions approved on 2026-09-16; written specification pending review.

## Context

Moving supported items to the Recycle Bin is recoverable and already presents an actionable Toast with Undo. Pure
confirmation dialogs therefore add a redundant step. Two deletion surfaces are exceptions: deleting an Assistant or
Agent also lets the user choose whether to move its active Topics or Sessions, while file removal may include external
files that never enter the Recycle Bin.

The Recycle Bin category selector also uses an implementation order that does not match the intended product order,
and its Simplified Chinese labels expose the untranslated term `Agent` and the inconsistent Painting label `绘画`.
The shared Toast renders its action as a text link even though Undo is an inline secondary action.

## Goals

- Execute recoverable move-to-Recycle-Bin actions without a pure confirmation dialog.
- Preserve dialogs that collect an additional choice or warn about non-Recycle-Bin file removal.
- Render Toast actions as compact outlined buttons.
- Order Recycle Bin categories as Assistant, Topic, Agent, Session, Painting, File.
- Display the Simplified Chinese category labels as 助手、话题、智能体、会话、绘图、文件.

## Non-goals

- Changing permanent-delete or Empty Recycle Bin confirmations.
- Removing the Assistant or Agent cascade-selection dialog.
- Changing external-file or mixed internal/external file removal confirmation.
- Changing deletion, restore, retention, or Undo data semantics.
- Adding a preference that controls confirmations.

## Alternatives Considered

### Remove pure confirmations at their consumers — selected

Recoverable actions run directly from their existing buttons or menu commands and continue to use the existing Undo
feedback. Assistant and Agent owner deletion retains its cascade-selection dialog. File deletion skips confirmation
only when every selected file is internal; external-only and mixed selections keep their current explanations.

This is the smallest change and keeps confirmation policy visible at each surface where the semantic distinction is
known.

### Add a shared recoverable-delete policy

The Action Registry, popup service, or shared dialog could accept a flag that bypasses confirmation. This would widen
shared APIs for one feature and hide business semantics inside generic infrastructure, so it is rejected.

### Keep dialogs but reduce their emphasis

Changing copy or button styling would leave the redundant interaction in place and does not satisfy the requested
behavior, so it is rejected.

## Interaction Design

The following recoverable actions execute immediately:

- one Topic or Agent Session;
- one Painting;
- an internal-file-only selection;
- clearing an Assistant's active Topics or an Agent's active Sessions;
- row and batch deletion in Assistant/Agent history views.

The mutation's existing pending guard, stale-state handling, refresh behavior, error feedback, and Undo Toast remain
unchanged. Topic deletion remains disabled while generation is unsettled.

The following dialogs remain:

- Assistant and Agent deletion, because the unchecked option controls whether related conversations are also moved;
- external-file-only and mixed file removal;
- permanent deletion and Empty Recycle Bin.

Protected built-in Agents themselves remain undeletable, but their recoverable “Delete all sessions” action no longer
uses a confirmation because it collects no additional choice.

The Toast action uses the shared `Button` with `variant="outline"` and `size="sm"`. The shared component owns hover,
focus, disabled, light-theme, and dark-theme behavior; no page-local colors are introduced.

## Content and Ordering

The category source order becomes:

1. Assistants
2. Topics
3. Agents
4. Sessions
5. Paintings
6. Files

Simplified Chinese changes only the two incorrect category values:

- `settings.data.trash.domain.agents`: `智能体`
- `settings.data.trash.domain.paintings`: `绘图`

The remaining locale keys and translations are unchanged.

## Verification

- Action-registry and component tests prove Topic and Session actions no longer expose or open a confirmation before
  invoking deletion.
- Painting, history, group-clear, and internal-file tests prove recoverable actions run directly.
- File tests prove external-only and mixed selections still confirm.
- Assistant and Agent owner-deletion tests prove their cascade-selection dialogs remain.
- Toast tests assert the Undo action uses the compact outlined Button contract and still dismisses before invoking
  its callback.
- Trash settings tests assert the category order; i18n checks validate the changed Simplified Chinese values.
- Run focused renderer and UI package tests first, followed by `pnpm i18n:check` and the repository-required lint gate.
