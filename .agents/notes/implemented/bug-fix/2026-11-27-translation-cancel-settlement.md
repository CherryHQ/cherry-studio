# Agent Note: Settle translation cancellation in the renderer

Status: implemented

English | [中文](2026-11-27-translation-cancel-settlement.zh.md)

## Problem

Main can acknowledge a paused prompt stream with `ai.stream.done`. The translation bridge treated that event as completion. Stopping inline translation before any output could therefore report an empty result error, and stopping after a chunk could invoke the success callback. A failed abort request could also leave the renderer waiting for a terminal event.

## Decision

The caller's abort signal settles the renderer translation with `AbortError`, removes its subscriptions, and still forwards the existing stop command to Main. Home chat waits for queued writes after cancellation. It preserves the last nonempty translation that was successfully persisted, or clears the empty placeholder while the same controller owns it. The persistence result is the authority for preserving partial text because the read query may still show an older snapshot.

## Alternatives considered

- Waiting for Main's terminal event leaves the renderer dependent on a response that may never arrive and allows a paused event to race with cancellation.

## Consequences

The renderer can end cancellation immediately while Main drains the provider request. Normal completion still delivers the final trimmed text to its caller.

## Verification

- Regression — `src/renderer/utils/translate/__tests__/translateText.test.ts`: verifies silent abort settlement and subscription cleanup with paused events or failed abort IPC.
- Regression — `src/renderer/pages/home/messages/__tests__/homeMessageListAdapter.test.tsx`: verifies clearing empty output and preserving saved partial text before the message query refreshes.
- Regression — macOS Electron with a loopback SSE provider: verified both stop paths, provider connection closure, and persistence of the full result on a subsequent successful translation.
