---
description: Reusable conversation handoff note - threshold offer, editable review, explicit save, and new-conversation attachment
sources:
  - src/main/ai/messages/handoffNote.ts
  - src/main/ai/AiService.ts
  - src/main/ipc/handlers/ai.ts
  - src/shared/ipc/schemas/ai.ts
  - src/renderer/components/chat/shell/ConversationHandoff.tsx
  - src/renderer/pages/home/ChatContent.tsx
  - src/renderer/pages/home/HomePage.tsx
  - src/renderer/pages/agents/AgentChat.tsx
  - src/renderer/pages/agents/AgentPage.tsx
---

# Conversation Handoff Note

English | [中文](conversation-handoff.zh.md)

Canonical reference for the reusable handoff note that moves long-running work into a
fresh conversation before the context limit destroys detail.

## Ownership

`ConversationHandoff` (renderer) owns the offer state, the review dialog, and every
user action. It is mounted above the conversation stage in both surfaces:
`ChatContent.tsx` for topic chat and `AgentChat.tsx` for agent sessions. `AiService`
owns generation through the `ai.handoff.generate` IPC route; no renderer code reads
messages or calls providers directly.

## Offer threshold

The offer appears when the conversation's measured context usage reaches 80% of the
selected model's context window. Topic chat derives the percentage from the active
branch's `contextUsage`; agent sessions read `useAgentSessionContextUsage`. The offer
is non-blocking, renders once per conversation until dismissed, and never generates,
saves, or attaches anything by itself. A manual "Create handoff" action is available in
any conversation with at least one message, regardless of usage.

## Generation source

`readHandoffSource` reads the stored selected branch through
`readAllConversationMessages`, not the compacted model-facing projection, so generation
does not depend on pausing automatic compaction. Long conversations are split into
UTF-8-bounded chunks derived from the model's context window; each chunk is extracted
chronologically and hierarchical rounds combine the notes until one Markdown document
fits. Every request is cancellable through `ai.text.abort`, and a generation failure
leaves the source conversation and compaction untouched with a retryable error.

## Review step

Generation only fills an editable preview. The dialog discloses that the selected model
reads the stored conversation, including tool results, and that generation can use
several model requests. The required sections, in order, are Goals, Confirmed
decisions, Constraints, Pending questions, Relevant files, and Next steps;
`validateHandoff` rejects model output missing any of them. Cancelling writes nothing.

## Save and attachment

Nothing is exported without an explicit action. "Save Markdown" writes the edited text
through `window.api.file.save`. "Attach to new conversation" creates a fresh topic in
the same assistant (or a fresh session for the same agent) and seeds the reviewed file
as a composer draft through the draft caches in `HomePage.tsx` and `AgentPage.tsx`; the
first request then carries the handoff file, not the original transcript. The source
conversation is never modified.
