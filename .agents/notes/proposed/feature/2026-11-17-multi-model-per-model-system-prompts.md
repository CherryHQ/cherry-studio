# Agent Note: Per-Model System Prompts in Multi-Model Turns

Status: proposed

English | [中文](2026-11-17-multi-model-per-model-system-prompts.zh.md)

Tracks: CherryHQ/cherry-studio#18321

## Problem

A multi-model turn fans out to several models. The mention list is `mentionedModelIds: UniqueModelId[]` (`src/shared/ai/transport/stream.ts:194`), resolved by `resolveModels` (`src/main/ai/streamManager/context/modelResolution.ts`). Every branch still takes its system prompt from the topic's single assistant (`src/main/ai/runtime/aiSdk/params/assembleSystemPrompt.ts:38`). Users cannot compare model-and-prompt pairs in one turn, and a stored reply cannot show which prompt produced it.

## Proposal

1. **Optional prompt per mention.** A mention entry becomes `{ modelId, systemPrompt? }`. Bare `UniqueModelId` values stay accepted so existing callers and persisted turns keep working. A missing or empty `systemPrompt` uses the topic assistant's prompt.
2. **Per-branch prompt resolution.** The system prompt is resolved for each model before that model's request is built. An override is never read by another branch.
3. **Record the effective prompt on the reply.** Each assistant placeholder stores the prompt text it used in its turn options. Regenerate and edit-and-resend reuse that recorded value, so they do not re-read the current assistant prompt.
4. **Attribution in the UI.** Each response shows its model. When an override was used, it also shows a short label of the prompt, with the full text available on expand.
5. **Template variables.** Overrides go through the same `replacePromptVariables` path as assistant prompts.

Out of scope: mentioning assistants (the second shape in the issue, which overlaps #15396), changing assistant prompt semantics, and new prompt-preset storage.

## Alternatives considered

- **Mention assistants instead of models.** Conceptually clean, since an assistant already pairs a model with a prompt. Rejected for this Spec: it broadens the change into assistant/agent unification (#15396) and changes what a mention means everywhere.
- **Put the prompt difference in the user message.** Rejected by the issue: it cannot carry system-role priority and pollutes the visible transcript.
- **Separate topics per prompt.** Status quo. It loses the side-by-side comparison that motivates multi-model turns.
- **Recompute prompts on regenerate from the current assistant.** Rejected: the pairing would silently change after the user edits the assistant, which breaks the comparison.

## Acceptance criteria

- AC1 — A turn with two or more mentions, each with a different `systemPrompt`, sends each branch's request with its own prompt (verification: unit)
- AC2 — A mention without `systemPrompt` sends the topic assistant's prompt unchanged from current behavior (verification: unit)
- AC3 — No branch's override appears in another selected model's request (verification: unit)
- AC4 — Regenerate and edit-and-resend use the prompt recorded on the original reply, not the current assistant prompt (verification: unit)
- AC5 — Each assistant reply shows its model, and a prompt label when an override was used, after reloading history (verification: renderer)
- AC6 — Bare `UniqueModelId` mentions dispatch exactly as before (verification: unit)
- AC7 — Template variables in an override resolve the same way as in an assistant prompt (verification: unit)

## Risks

- Persisted prompt text increases message size. Mitigation: bound the override length during implementation and store the text only on replies that used an override.
- Overridden branches have a different prompt prefix, which can lower provider prompt-cache hit rates. Mitigation: state this in the UI copy only if measurements show a real cost.
- Unverified: whether per-branch request building is fully separable from the single assistant lookup on the request path (`src/main/ai/AiService.ts`, around lines 1375 and 1659). Implementation must confirm this before the Spec is approved.
