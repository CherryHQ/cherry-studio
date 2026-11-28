# Agent Note: Optional Editable Handoff When Switching Agent Models

Status: implemented

English | [中文](2026-11-17-optional-editable-model-switch-handoff.zh.md)

## Problem

Switching the model of a non-empty Agent session keeps the conversation history, but the new model may interpret a long or partially completed task poorly. Issue #18978 asks for an optional, user-editable task handoff at the switch point. The session owns its model selection, as recorded in [Session-owned model selection](../../implemented/bug-fix/2026-11-14-agent-session-model-ownership.md). Before this change, `AgentChat.tsx` showed a model-switch dialog with only a "skip for this app run" checkbox; confirming only updated the session model. Users had no built-in editable task brief or switch-provenance record.

## Decision

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

## Consequences

- Native runtime resume: sessions carry runtime resume tokens and context projections. A system message inserted mid-session must not invalidate a native resume or be dropped by projection. Production Pi bridge and real Claude Code SDK resume tests verify the same native session, preserved task history and system-only handoff delivery.
- Cross-runtime switches: switching runtime type may change how system messages are delivered. The handoff must reach the model as context, not as a user turn.
- Generation cost and latency: the handoff call runs on the current model before the switch completes. Cancelling during generation must not switch the model.
- Summary accuracy: the editable field is the mitigation; the note does not claim the generated summary is complete.

## Verification

- AC1 — Unchecked dialog and normal model-update behavior pass in `ModelSwitchHandoffDialog.test.tsx` and `AgentChatSettingsPanel.test.tsx`; no generation is requested.
- AC2 — `AgentSessionModelHandoff.test.ts` verifies generation with the captured current model, six separate required sections and no preview persistence.
- AC3 — The dialog, actual AgentChat save-route and `useSession.test.ts` tests preserve reviewed edits through the atomic endpoint; the real file-backed database test verifies exact edited-text persistence.
- AC4 — The database test verifies previous/next identities, unchanged original messages, native resume token retention, stale-source refusal, busy-run refusal and rollback on message-save failure.
- AC5 — `PiRuntimeConnection.test.ts` resumes real native history through the production bridge on the next model with edited system context. `nativeContract.test.ts` resumes the real Claude Code SDK with a changed model and system prompt, preserving original history without inventing a user turn. `settingsBuilder.test.ts` verifies the saved handoff reaches the production non-snapshotted carrier.
- AC6 — The AgentChat and dialog renderer tests verify normal unchecked switching and cancellation with no switch or handoff data.
- AC7 — The dialog test verifies visible generation failure followed by a successful unchecked switch.

- Regression — Inspected real UI controls and catalogs in English/light and narrow Chinese/dark. Generation/save are fixture boundaries, not full Electron acceptance. Native tests use local scripted providers without paid calls.
