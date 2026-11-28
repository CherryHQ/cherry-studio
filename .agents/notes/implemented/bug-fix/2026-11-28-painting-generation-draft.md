# Agent Note: Preserve painting draft edits during generation

Status: implemented

English | [中文](2026-11-28-painting-generation-draft.zh.md)

## Problem

The painting composer stays editable during generation. A terminal result replaced the visible draft with the request snapshot, discarding image options and prompt edits made while the request was running.

## Decision

Keep the submitted request snapshot for generation and file persistence. Apply terminal status and output files to the latest visible draft using a state update guarded by the painting ID.

## Alternatives considered

- Disable the composer during generation. This would prevent users from preparing their next request while a generation runs.

## Consequences

Edits made during generation remain in the composer. A result from another painting updates its history without taking over the visible draft.

## Verification

- Regression — `usePaintingGeneration.test.ts` changes size and quality while an image is pending and checks both the new values and the returned file after completion.
