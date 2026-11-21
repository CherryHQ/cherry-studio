# Agent Note: Optional Editable Handoff When Switching Agent Models

Status: proposed

English | [中文](2026-11-17-optional-editable-model-switch-handoff.zh.md)

## Problem

Switching the model of a non-empty Agent session keeps the conversation history, but the new model may interpret a long or partially completed task poorly. Issue #18978 asks for an optional, user-editable task handoff at the switch point. The session owns its model selection, as recorded in [Session-owned model selection](../../implemented/bug-fix/2026-11-14-agent-session-model-ownership.md). Today `AgentChat.tsx` shows a model-switch dialog with only a "skip for this app run" checkbox; confirming updates the session model and nothing else. Users who want a task brief for the new model have no way to create one, and switch provenance is not recorded.

## Proposal

- In the existing model-switch confirmation dialog, add an option "Create a handoff for the new model", unchecked by default.
- When selected, generate a handoff with the current model: objective, decisions, completed work, pending steps, relevant files, unresolved risks.
- Show the generated handoff in an editable field inside the dialog. The user confirms or edits before the switch completes.
- On confirm, persist the edited handoff as a system message in the same session, linked to a switch record holding the previous and next model identities. Original messages are neither modified nor removed.
- When the option is not selected, the switch behaves as today, and conversation history remains the source of context.
- The next turn on the new model receives the edited handoff through session context.

## Alternatives considered

- Always prompt for a handoff on every switch: rejected by the issue ("instead of forcing it for every switch").
- Deterministic summary without an LLM call: cheaper and offline, but cannot reliably extract decisions and pending steps. Possible fallback if generation fails; not in this Spec.
- New session seeded with the handoff: keeps the old session clean but splits conversation and files across two sessions. Rejected for this iteration.
- Store the handoff only as a composer draft: loses provenance and is not in the new model's context. Rejected.

## Acceptance criteria

- AC1 — The switch dialog offers the handoff option unchecked by default; with it unchecked, the switch makes no LLM call and persists no handoff data (the session's selected model still updates, as today) (verification: renderer)
- AC2 — With the option checked, a generated handoff separates completed and pending work and lists relevant files and risks (verification: unit)
- AC3 — The user can edit the generated handoff before confirming; the persisted system message contains the edited text, not the generated text (verification: renderer)
- AC4 — The persisted handoff records both the previous and next model identities; original messages are unchanged (verification: unit)
- AC5 — The next turn after a handoff sends the edited handoff to the new model in its context (verification: unit)
- AC6 — Confirming a switch without a handoff updates the session's selected model and preserves the existing history with no handoff data added; cancelling the dialog leaves the session entirely unchanged (verification: renderer)
- AC7 — If handoff generation fails, the dialog shows the error and the user can still switch without a handoff (verification: renderer)

## Risks

- Native runtime resume: sessions carry runtime resume tokens and context projections. A system message inserted mid-session must not invalidate a native resume or be dropped by projection. Needs an implementation check across the Pi and Claude Code runtimes before AC5 can be verified.
- Cross-runtime switches: switching runtime type may change how system messages are delivered. The handoff must reach the model as context, not as a user turn.
- Generation cost and latency: the handoff call runs on the current model before the switch completes. Cancelling during generation must not switch the model.
- Summary accuracy: the editable field is the mitigation; the note does not claim the generated summary is complete.
