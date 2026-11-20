# Agent Note: Show the producing provider beside the model in reply headers

Status: implemented

English | [中文](2026-11-14-message-header-provider-name.zh.md)

## Problem

Assistant reply headers show the producing model but not the provider that served it. Users who route one model through several providers cannot tell which one produced a reply. v1 rendered `model | provider`.

Each message already keeps the producing provider id in its model snapshot, but not a display name, and custom provider ids are UUIDs.

## Decision

Wherever `MessageHeader` shows the model label, it appends the provider's current display name as `model | provider`. The name is resolved in the renderer from the message's own provider id with the existing `useProviderDisplayName` hook, which the token details card already uses for the same id. The query runs only when the model label is shown.

Multi-model fold headers now show the label too. The fold tabs name the model but not the provider, so hiding the header label there left same-model replies from different providers indistinguishable.

Provider instances with editable names use their saved names. Canonical presets use localized labels. Provider changes refresh open replies across windows. Deleting a provider leaves the model-only label, including after a later lookup fails.

Narrow headers give the model name priority and hide the separator with the provider when the pair runs out of room. Hover shows the full text. Topic image capture waits for a bounded provider lookup and wraps long names within the header.

## Alternatives considered

- Freeze a provider name in `ModelSnapshot` at creation. Old labels would survive renames and deletion, but every message write path and the shared type would change, and the header would disagree with the token details card after a rename.
- Show the provider only on hover. Smaller, but the provider stays hidden while scanning replies, which is the v1 behavior users miss.
- Append the provider to the assistant name. This mixes author identity with routing.
- Show the provider in the fold tabs instead of the fold header. Every expanded tab gets wider, and each tab needs its own provider lookup.

## Consequences

Deleting a custom provider removes its name from historical replies; keeping it would require the snapshot alternative.

In the fold layout the header repeats the model name shown on the selected tab.

## Verification

- Regression — Passing cases in `MessageHeader.test.tsx` cover the message's own provider, local renames, cross-window renames of an editable preset in the header and token details, and the model-only label after deletion followed by a timeout.
- Regression — `MessageList.test.tsx` verifies that export waits for an offscreen reply's provider lookup and omits the name of a missing provider.
