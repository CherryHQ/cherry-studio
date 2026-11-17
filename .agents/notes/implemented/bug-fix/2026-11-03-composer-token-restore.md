# Agent Note: Composer rebuild restores live tokens when the draft seed is empty

Status: implemented

English | [中文](2026-11-03-composer-token-restore.zh.md)

## Problem

Rebuilding composer editor content from `{ text, tokens: draftTokens ?? [] }` relies on a token seed that is only read once at mount (`ChatComposer`'s `useState` initializer over the draft cache). When the editor is rebuilt later — for example after navigating to Settings and back — `text` is current while the seed is empty, so a knowledge or MCP-resource chip's folded `promptText` is materialized as plain prose. The token sync effect then re-adds the chip, leaving the instruction sentence standing in the draft as user text, and the corrupted pair is reproduced on every subsequent rebuild. Reported in #23454.

## Decision

`resolveComposerRestoreTokens(text, draftTokens, liveTokens)` fills the gap at rebuild time: when the seed is empty, live tokens whose `promptText` occurs in `text` are restored as serialized tokens at the offset where the text occurs. A non-empty seed is used verbatim, so message-editing restore behavior is unchanged, and tokens without `promptText` (files) are untouched.

## Alternatives considered

- Always rebuild from the live tokens: rejected — `draftTokens` is authoritative for edited-message restore, where live selection state may disagree with the persisted draft.
- Strip unclaimed prompt-text copies from `text` to heal already-corrupted drafts: rejected — that sentence may be user-typed content (quoting this very bug), and silently deleting user text is worse than leaving a stray sentence that clearing the input resets.

## Consequences

Drafts corrupted before this fix keep their stray sentence until the input is cleared; new corruption no longer occurs on rebuild.

## Verification

- Regression — `pnpm test:renderer src/renderer/components/composer/__tests__/ComposerSurface.test.tsx -t "rebuilds a chip from the live token"`: renders a rebuilt composer whose `text` embeds the knowledge prompt text with an empty seed and asserts the chip node is restored instead of prose.
- `pnpm test:renderer` over `ComposerSurface.test.tsx`, `composerDraft.test.ts`, `composerInputAdapter.test.ts`: 214 passed.
