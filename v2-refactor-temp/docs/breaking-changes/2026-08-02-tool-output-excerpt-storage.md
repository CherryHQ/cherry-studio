---
title: Oversized tool outputs are stored as excerpts with on-demand full view
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-08-02
---

## What changed

Tool call results larger than the context truncation threshold (default 100,000 characters) are no longer stored in full inside the chat message record. The message keeps a head/tail excerpt; the full text is stored once in the app's managed file storage and is fetched on demand when the tool card is expanded. The stored copy lives exactly as long as the message referencing it — deleting the message, branch, or topic reclaims it automatically. Temporary chats are unaffected (in-memory only); in temporary chats and one-shot utility calls, oversized tool outputs are truncated inline without a stored copy.

## Why this matters to the user

Chat databases stop growing by megabytes per large tool call (the same output re-sent across turns or regenerated siblings is stored once). Viewing an old large tool output now involves a brief load when the card resolves the full text. If the stored copy is ever missing (e.g. a restored older backup), the card shows the excerpt with a note instead of the full output — the conversation itself is unaffected.

## What the user should do

Nothing — automatic. Existing conversations keep their full outputs in place; only newly persisted results use excerpt storage.

## Notes for release manager

The pre-existing temp directory (`<temp>/CherryStudio/context-build-vfs`) is removed once at startup. The model-facing `fs_read` tool is now restricted to exactly the persisted outputs referenced by the current conversation (previously: the whole temp directory).
