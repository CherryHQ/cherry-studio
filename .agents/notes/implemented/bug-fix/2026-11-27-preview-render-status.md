# Agent Note: Keep preview status tied to the current render

Status: implemented

English | [中文](2026-11-27-preview-render-status.zh.md)

## Problem

A diagram render may still finish after new input is queued or the preview is cancelled. Its completion could clear the new preview's spinner or display an error for the discarded input.

## Decision

The shared preview hook assigns a version when the render is requested and invalidates it on cancellation. Only the current version can publish loading or error state. Assigning the version before debounce prevents older work from publishing during the debounce delay.

## Alternatives considered

- Cancelling the debounce timer alone cannot prevent an already-started render from settling.

## Consequences

Errors from the current preview remain visible. The guard covers shared loading and error state. Renderers continue to own their output and cancellation capabilities.

## Verification

- Regression — `src/renderer/components/Preview/__tests__/useDebouncedRender.test.ts`: a superseded failure does not end a newer preview's loading state and an in-flight failure stays hidden after cancellation.
