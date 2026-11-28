# Agent Note: Per-model system prompt comparisons

Status: implemented

English | [中文](2026-11-24-model-prompt-comparisons.zh.md)

## Problem

A multi-model turn previously reused one assistant prompt for every response. Model-only comparison could not compare model/prompt configurations or reproduce those configurations after the assistant changed.

## Decision

The normal chat composer offers a collapsed Model prompt comparison section when several models are selected. Each model has an optional override, keyed by its full provider/model ID, not by its position. An unchecked model inherits the current assistant prompt. A checked, empty field means an intentionally empty user system prompt.

Main validates duplicate and unselected IDs before creating messages. A comparison snapshots every selected model's prompt, including inherited prompts, into the reply's turn controls. Each branch reads only its own entry. Ordinary requests without overrides keep the existing assistant lookup. New unrelated turns never inherit a previous comparison implicitly.

Prompt overrides replace the user-authored assistant prompt, not citation instructions, MCP instructions, or other runtime guidance. The normal prompt-variable resolver is reused. Anthropic caching checks the effective override for volatile variables.

Queued drafts, draft cache restoration, regeneration, retry, tool-approval continuation and edit-and-resend carry the association. Historical reply headers offer model-labelled prompt readback. Override controls are not shown during historical editing; resend keeps that historical turn's configuration. Temporary and Agent session transports reject this ordinary-chat-only feature before writing rather than silently dropping prompts. Busy explicit steers reject prompt comparisons; the composer queue can wait for idle.

## Alternatives considered

- Mentioning assistants expands this into assistant/agent unification.
- Putting instructions in the user text loses system-role semantics.
- Recomputing inherited prompts on regenerate changes the comparison after an assistant edit.
- Replacing the entire assembled system string would remove runtime/tool instructions.

## Consequences

No new database table, preference or network service is introduced. Prompt text is stored locally with the reply and sent to its selected model provider as normal system instructions. Other locale strings fall back to English; Simplified and Traditional Chinese have Chinese labels. The existing one-entry-per-model selection does not add duplicate executions of the same model.

## Verification

- Regression — #18321: real database dispatch regressions cover independent model prompts, inherited prompt snapshots, later assistant edits, regeneration, invalid pair rejection before writes, and no leak into a later ordinary turn.
- Regression — Prompt assembly tests cover variables, empty override, inherited prompt and retained MCP instructions.
- Regression — Renderer regressions cover independent fields after reordering, history readback, retry forwarding and edit-and-resend of a multi-model association.
- Regression — Browser inspection uses the actual prompt editor in English/light/wide and Chinese/dark/narrow with fixture models, not a native Electron or paid-provider run.
