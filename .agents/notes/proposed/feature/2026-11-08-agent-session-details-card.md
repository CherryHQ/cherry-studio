# Agent Note: Compact Agent session details card

Status: proposed

English | [中文](2026-11-08-agent-session-details-card.zh.md)

## Problem

Agent session status is registered as a full-height right-panel capability. Even an unavailable context reading occupies an entire inspector column. Its toolbar shortcut also has a separate hover preview, so a small amount of information has two presentations and a click changes the conversation geometry unnecessarily.

The requested reference is T3 Code's content-height thread details card: compact rows, quiet section dividers, an inline card when space permits, and a toolbar-anchored popup otherwise. Only Agent session details are in scope. Files, Browser, Trace, resources and task execution views retain their existing large panels.

This is a new presentation decision. It preserves the data semantics in [Harness-owned context usage](../architecture/2026-10-30-agent-context-usage.md) and the work-panel identity rules in [Bind right-panel presentation to its instance](../../implemented/bug-fix/2026-10-31-right-panel-presentation-identity.md). It does not claim to complete either proposal's outstanding acceptance work.

## Proposal

### Card and placement

Replace the Status shortcut and its hover preview with one Session details toggle and one content owner. Use the shared Button, Tooltip, Popover, ScrollArea and disclosure primitives from `@cherrystudio/ui`. Follow `DESIGN.md` semantic surfaces, typography, focus and light/dark behavior; do not copy T3's literal colors or introduce a second design system.

The card has a target width of 280 CSS pixels, a 12-pixel outer clearance, a subtle border and rounded container corners. It sizes to its content up to the available height. There is no full-height background, resize handle, large Status heading or card inside a card. Groups use compact rows and dividers; row actions retain usable pointer targets and keyboard focus. Long labels truncate with access to their full text. Overflow scrolls inside the card.

Choose placement from the actual conversation center and occupied message/composer bounds, including the existing navigation gutter and open work panels. When at least the card width and clearance fit to the right of that content, place the card below the toolbar in that free space. The card does not reserve a new column or change message/composer widths. In full-width chat, or whenever the free space is insufficient, use a non-modal popup anchored below the details toggle, aligned to its right edge and constrained to the viewport. Preserve the user's existing narrow/full-width chat preference.

Bound inline height above the composer; bound popup height to the available viewport. A popup may temporarily overlay content, but never becomes a full-height work pane. A wider window alone is not proof that inline placement fits. Existing shell overlay slots should be used where adequate; any required shared-shell change is limited to exposing the real bounds or placement slot, not redesigning its panel sizing system.

### Visibility, focus and identity

The card starts closed. Clicking the toggle opens or closes it in the available placement; hovering only shows the toggle's tooltip. The toggle exposes its accessible name and expanded state. Inline opening does not steal composer focus. Popup focus, outside-click dismissal and Escape behavior use the shared Popover contract; keyboard dismissal returns focus to the toggle. Inline Escape dismissal applies only while focus is inside the card, so it does not intercept composer or unrelated panel shortcuts.

When an open inline card loses its free space, close it rather than automatically covering the conversation with a popup. The next toggle opens the popup. An explicitly open popup may become inline when space becomes available, preserving its content state and a valid focus target. Never mount two copies of the live content to measure alternate layouts. Opening, closing or resizing the card must not start a model turn, compact context, or introduce a new polling loop.

Session identity owns visibility and disclosure state. Switching sessions or leaving the Agent conversation closes the card and clears its expanded groups; returning does not replay old open intent. Missing or pending sessions use the existing readiness contract. Late updates from the previous session must not appear in the new card. No new persisted preference or database migration is needed.

Files and Browser remain independently controlled work panels. Opening one recomputes the available card space without changing that panel's identity, state or auto-open policy. While a work panel is maximized, hide/close details along with the existing toolbar controls; restoring the panel does not reopen details automatically.

### Content and actions

Preserve the current status capabilities in this order: artifacts, workflows, subagents, background shell tasks, then context usage. Omit empty task/artifact groups and their dividers. Show one compact summary row per populated group with its count; expand in place to access the existing entries and actions. Preserve task state, errors, stop controls and pending-operation feedback. Do not manufacture device, editor, Git, project-script or weekly-quota rows to match the reference screenshot.

Context usage remains visible as one row with a label, thin progress meter, percentage and disclosure affordance when a usable reading exists. Expanding reveals the current token totals, model, precision/coverage information, categories and resources. Preserve all currently supported information and the same denominator as the composer. A missing reading is explicitly unavailable, not zero; a measured zero remains a valid zero. Compaction and partial/estimated readings retain their existing semantics. Do not replace runtime-owned usage interpretation with renderer estimates or confuse context occupancy with billing/subscription quota.

The current artifact and task actions continue to open their existing work-panel destinations. Dismiss a popup after navigating to a destination and focus that destination; an inline card may remain only if it still fits. Stopping a task does not navigate or dismiss the card. For a task execution view's Back action, retain nested task navigation; at the root, close the task work panel and explicitly open session details instead of requesting the removed Status capability. This return action is a user open intent, so popup placement is allowed if inline placement cannot fit.

### Implementation boundary and delivery

The Agent page owns the card's session-scoped state and data subscriptions. Extract the detail presentation from `AgentRightPane.tsx` only as needed for this boundary; remove the Status capability, its old hover body and the obsolete navigation path together. Keep the shared right-panel registry and presentation provider responsible for the remaining work panels. Reuse the current usage hook, task projections and actions instead of constructing a second data cache or runtime owner. The composer and child-task usage summaries must retain their existing presentations.

After exact-head Spec approval, implement one focused layer covering the card, integration, localization and regression checks. Use renderer tests for open/close, identity, navigation and action contracts. Use real Electron for geometry, focus and scrolling; component tests or screenshots of a mockup do not establish visual acceptance. Keep this note proposed until every acceptance criterion has actual evidence.

## Alternatives considered

- Only reduce the inspector width or remove its border: leaves full-height allocation and two competing presentations.
- Use only a popup at every width: simpler, but omits the persistent, unobtrusive inline card requested by the reference.
- Reserve a new fixed sidebar column for the card: still reduces conversation width for a small amount of information.
- Redesign all right-side capabilities or copy T3's canvas/density system: exceeds the confirmed scope and risks file editing, browser state and execution navigation.
- Fill the card with new environment or quota features: adds unrelated capabilities without existing data contracts.

## Acceptance criteria

- AC1 — Status opens only the new details surface; the former full-height Status pane and separate hover preview are gone, while all other work-panel destinations remain available. (verification: renderer — AgentRightPane and AgentChat integration tests)
- AC2 — Inline details occupy only measured free space, remain content-height and leave message/composer bounds unchanged; constrained or full-width layouts use a viewport-bounded popup without horizontal overflow. (verification: Electron — light/dark, narrow/full-width chat and window resize matrix)
- AC3 — Toggle, outside click, Escape and inline/popup transitions follow the specified focus and dismissal rules without duplicate live content, inaccessible controls or unsolicited floating content. (verification: renderer and Electron — pointer/keyboard interaction and resize scenarios)
- AC4 — Session replacement, pending/unavailable readiness, leaving the conversation and maximized work panels cannot display stale details or replay previous visibility/disclosure intent. (verification: renderer — identity/readiness transitions; Electron — real session switching)
- AC5 — Populated artifact/workflow/subagent/shell groups retain their entries, task states, failures and stop controls; empty groups disappear and long content remains navigable within the card. (verification: renderer — mixed task and artifact contracts; Electron — long labels and overflow)
- AC6 — Usage preserves valid zero, unknown, compaction, partial/estimated readings, totals, categories and resources, with the same denominator as the composer and no new model work or polling. (verification: renderer — usage-state matrix and affected composer consumers)
- AC7 — Artifact/task navigation opens the existing destinations, nested Back remains intact, root Back opens details, and file edits/browser identity and auto-open behavior are preserved. (verification: renderer — AgentChatArtifactPane and affected panel consumers; Electron — destination/Back and active file/browser scenarios)
- AC8 — All changed strings are translated, semantic UI tokens and accessible names work in both themes, and the bilingual proposal passes documentation gates; implementation evidence is recorded before lifecycle transition. (verification: docs gate and Electron — translation/pairing checks and themed keyboard walkthrough)

## Risks

Available space depends on sidebar state, message width, navigation gutters, work panels, window size and zoom. A viewport-width breakpoint alone can overlap content. Measurement must avoid feedback loops and preserve the existing scroll position as placement changes.

Task lists and context resources can be large. Progressive disclosure and bounded scrolling must not hide pending actions or remove error information. Popover dismissal must respect nested menus and dialogs owned by task actions. Session-owned presentation must not reset workspace-owned file state or browser runtime resources.

The reference's small footprint depends on available content, not decorative empty space. Actual Cherry fixtures must demonstrate the compact empty state as well as busy sessions; this Spec contains no claim that UI implementation or Electron acceptance has already passed.
