# Agent Note: Recover typed chat drafts after window reload

Status: implemented

English | [中文](2026-11-27-chat-draft-reload.zh.md)

## Problem

Reloading the chat window discards the renderer's in-memory composer cache. The topic and sent messages reopen, but the user's unsent text disappears. [Issue #25530](https://github.com/CherryHQ/cherry-studio/issues/25530) reproduces the loss in an existing topic.

## Decision

The ordinary chat composer keeps a same-window recovery copy of typed text in session storage, keyed by its existing topic or composer scope and subject to the existing 24-hour expiry. The live in-memory draft takes precedence and continues to hold attachments, tokens, and selections. Recovery retains pasted URLs and filled prompt-variable values as plain text, without token metadata, and excludes other token-supplied prompts. Clearing a draft removes its recovery copy. A successful send also clears a matching submitted draft from the topic cache even after its composer unmounts; a newer draft with different text or tokens survives.

If a recovery write exceeds the storage quota, the composer reclaims expired entries under its own draft-key prefix and retries once when it has reclaimed space. Other session-storage entries and unexpired drafts remain intact.

## Alternatives considered

- A shared cache would expose the draft across windows and require waiting for the main-process snapshot before the composer can hydrate.
- Persisting the complete draft as JSON would serialize a pasted attachment's Blob as an empty object and leave its file token pointing to unusable data. Recovery of attachment content would require a separate storage contract.

## Consequences

Text recovery applies to a reload of the same window. Closing the window ends its session. If session storage is unavailable, topic switches still use the live in-memory draft.

If the user returns to the original topic before a pending send is accepted, the remounted editor can still hold the submitted text and write it back on unmount. Clearing that live editor requires a separate synchronization contract.

## Verification

- Regression — `src/renderer/components/composer/variants/__tests__/chatDraftCache.test.ts`: recreates the renderer cache to verify per-topic text recovery, pasted URLs, filled variable values, clearing, expiry, omission of generated prompts and token metadata, preservation of newer token selections, and reclaiming expired entries after a simulated quota failure.
- Regression — `src/renderer/components/composer/variants/__tests__/ChatComposer.test.tsx`: defers send acceptance across a topic switch, then recreates the renderer cache to verify accepted text is cleared, rejected text and other topics survive, and newer text is preserved.
- Regression — macOS Electron development window: two topics retain their own draft text after a reload, the sent-message fixtures remain visible, and clearing one draft survives another reload.
