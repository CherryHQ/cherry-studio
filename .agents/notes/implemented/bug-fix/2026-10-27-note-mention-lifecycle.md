# Agent Note: Notes mention session cleanup

Status: implemented

English | [中文](2026-10-27-note-mention-lifecycle.zh.md)

## Problem

The Notes source in PR #20196 started lazily, but kept its directory watcher after the chat `@` panel closed. Closing during a pending load also needed to settle that request without leaking stale results into a reopened panel.

## Decision

The existing suggestion source forwards `onExit` to the Notes hook. Exit cancels the pending request and clears the directory root, so the existing `useDirectoryTree` lifecycle releases the native subscription. Each new load has its own request identity, including a close and reopen in one React batch. Late tree creation is disposed by the existing directory-session owner.

The composer also connects the real QuickPanel `onClose` callback to the active suggestion's exit function. That function uses Tiptap's `exitSuggestion` with the installed plugin key, without changing the draft or refocusing the editor. It ignores destroyed editors and stale query/range callbacks. This matters because an outside click or Escape can close the panel while the editor selection remains inside `@`; hiding the panel alone never triggers the source's `onExit`.

The Notes directory validator lives in `src/main/utils/notesDirectory.ts`, outside the generic file-service module. The typed IPC adapter and legacy `FileStorage` share that unchanged policy. Configured-path validation, default-path fallback, unlimited-depth Markdown discovery, and the existing attachment/token flow remain in place.

## Alternatives considered

- Retaining a watcher for the composer lifetime scans and observes Notes while the panel is unused.
- Reusing the previous request solely by path can accept stale data when the same panel is reopened before React commits.
- Keeping Notes selection policy in the generic file module couples that module to Notes-specific managed-directory restrictions.
- Calling only the Notes cleanup on panel dismissal leaves the suggestion active and allows a later update to reopen it. The existing Tiptap exit API owns dismissal and forwards cleanup through the normal source lifecycle.

## Consequences

Reopening reacquires a directory snapshot; filesystem discovery retains the existing asynchronous watcher and short builder-release grace period. Cancelled requests return no results. No persistent format, preference, credential access, or new reference-token kind is introduced. Mainline file-token source identities and draft protection remain authoritative.

## Verification

- Regression — `src/renderer/components/composer/__tests__/noteMentionPanel.lifecycle.test.tsx`: the real composer, Tiptap plugin, QuickPanel provider/view, UI primitives, virtual list, and directory hook release the mocked native subscription after an actual outside click or Escape. The draft survives, refocusing alone does not resubscribe, and retyping the trigger loads a fresh Notes snapshot. The outside-click case fails on the previous code because the directory watcher is never disposed.
- Regression — `src/renderer/components/composer/variants/chat/__tests__/useNoteReferenceMentionItems.lifecycle.test.tsx`: real directory-hook disposal over mocked IPC, fresh reopened results, cancellation, late tree cleanup, and same-batch reopening.
- Regression — `src/renderer/components/composer/variants/__tests__/ChatComposer.test.tsx` and `src/renderer/components/composer/tools/definitions/__tests__/noteReferenceTool.test.tsx`: Notes mentions and the existing reference tool keep the attachment workflow.
- Regression — `src/main/utils/__tests__/notesDirectory.test.ts`, `src/main/ipc/handlers/__tests__/file.test.ts`, and `src/renderer/services/__tests__/NotesService.test.ts`: configured-directory restrictions and fallback remain shared across transports.
