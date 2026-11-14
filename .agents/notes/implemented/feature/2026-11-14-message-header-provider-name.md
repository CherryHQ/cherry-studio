# Agent Note: Show the producing provider beside the model in reply headers

Status: implemented

English | [中文](2026-11-14-message-header-provider-name.zh.md)

## Problem

Assistant reply headers show the producing model but not the provider that served it. Users who route one model through several providers cannot tell which one produced a reply. v1 rendered `model | provider`.

Each message already keeps the producing provider id in its model snapshot, but not a display name, and custom provider ids are UUIDs.

## Decision

Wherever `MessageHeader` shows the model label, it appends the provider's current display name as `model | provider`. The name is resolved in the renderer from the message's own provider id with the existing `useProviderDisplayName` hook, which the token details card already uses for the same id. The query runs only when the model label is shown.

Multi-model fold headers now show the label too. The fold tabs name the model but not the provider, so hiding the header label there left same-model replies from different providers indistinguishable.

Renaming a provider updates old labels. Deleting one leaves the model-only label. Messages, schemas and main-process write paths are unchanged. Long labels truncate, and the full text is on hover.

## Alternatives considered

- Freeze a provider name in `ModelSnapshot` at creation. Old labels would survive renames and deletion, but every message write path and the shared type would change, and the header would disagree with the token details card after a rename.
- Show the provider only on hover. Smaller, but the provider stays hidden while scanning replies, which is the v1 behavior users miss.
- Append the provider to the assistant name. This mixes author identity with routing.
- Show the provider in the fold tabs instead of the fold header. Every expanded tab gets wider, and each tab needs its own provider lookup.

## Consequences

Deleting a custom provider removes its name from historical replies; keeping it would require the snapshot alternative.

In the fold layout the header repeats the model name shown on the selected tab.

## Verification

- Regression — `pnpm test:renderer src/renderer/components/chat/messages/frame/__tests__/MessageHeader.test.tsx`: 10 tests pass, including the message's own provider winning over the current model, a provider mutation refreshing an already-mounted header through the real provider hook and SWR, and an unresolved provider leaving the model label alone.
