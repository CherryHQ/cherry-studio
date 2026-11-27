# Agent Note: Recover typed chat drafts after window reload

Status: implemented

English | [中文](2026-11-27-chat-draft-reload.zh.md)

## Problem

Reloading the chat window discards the renderer's in-memory composer cache. The topic and sent messages reopen, but the user's unsent text disappears. [Issue #25530](https://github.com/CherryHQ/cherry-studio/issues/25530) reproduces the loss in an existing topic.

## Decision

The ordinary chat composer keeps a same-window recovery copy of typed text in session storage, keyed by its existing topic or composer scope and subject to the existing 24-hour expiry. The live in-memory draft takes precedence and continues to hold attachments, tokens, and selections. Recovery text excludes the prompt text contributed by tokens, and clearing or sending a draft removes its recovery copy.

## Alternatives considered

- A shared cache would expose the draft across windows and require waiting for the main-process snapshot before the composer can hydrate.
- Persisting the complete draft as JSON would serialize a pasted attachment's Blob as an empty object and leave its file token pointing to unusable data. Recovery of attachment content would require a separate storage contract.

## Consequences

Text recovery applies to a reload of the same window. Closing the window ends its session. If session storage is unavailable, topic switches still use the live in-memory draft.

## Verification

- Regression — `src/renderer/components/composer/variants/__tests__/chatDraftCache.test.ts`: recreates the renderer cache to verify per-topic text recovery, clearing, expiry, and removal of token-supplied prompt text.
- Regression — macOS Electron development window: two topics retain their own draft text after a reload, the sent-message fixtures remain visible, and clearing one draft survives another reload.
