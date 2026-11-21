# Agent Note: Live note references with source-path and current-content delivery

Status: proposed

English | [中文](2026-11-11-live-note-references.zh.md)

## Problem

Note references currently deliver a managed snapshot, so later edits and filesystem agent paths can diverge from the user's source note.

## Proposal

Carry explicit note provenance and its absolute source path through the conversation. Resolve the active Notes root for each request, check containment, and deliver current source content or an explicit unavailable state. Filesystem agents receive the source path under their existing permissions.

## Alternatives considered

- A new approval-gated builtin note writer is deferred: it introduces write authority, containment and an approval surface.
- Filesystem MCP or pointing the workspace at Notes requires separate configuration and does not carry explicit reference identity.
- A renderer action to apply a reply to a note requires a separate user workflow and does not give agents the source path.
- Inferring provenance from `.md` extensions is rejected: ordinary Markdown attachments are not note references.

## Acceptance criteria

- AC1 — A note selected by launcher or `@` mention carries `noteReference` and its absolute source path through send, persistence, edit round-trip and re-send; an ordinary file-picker Markdown attachment does not. (verification: composer tests)
- AC2 — Each chat request carries the source path and the current disk content for every referenced note in the retained conversation, including after edits and compaction; the body is capped by the existing attachment budget and an unreadable source yields an explicit unavailable state instead of stale bytes. (verification: chat and retained-context tests)
- AC3 — `read_file` returns current referenced-note content with existing pagination. (verification: tool tests)
- AC4 — Claude Code, Pi and Pi Durable announce the source path rather than the managed copy. (verification: runtime tests)
- AC5 — Missing, unreadable or out-of-root sources produce an explicit unavailable state, never a silent snapshot, basename search or retargeting to another root. (verification: source-reader and consumer tests)
- AC6 — Notes refreshes an open clean note after external writes through the existing watcher chain and preserves the conflict dialog for dirty drafts, with no new code. (verification: Notes regression tests)

## Risks

This layer adds no write capability; ordinary chat still cannot edit a note. In-place editing uses agent runtimes' existing permission policy: default prompts and `acceptEdits`/Full Access remain unchanged. Windows path and junction behavior is unverified here.
