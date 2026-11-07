# Agent Note: Keep selection translation tied to its inputs

Status: implemented

English | [中文](2026-11-07-selection-translation-request-lifetime.zh.md)

## Problem

The selection translation effect depended on a callback whose identity changed when language detection and language lookup refreshed. An unchanged selection could therefore cancel its first request and start another. In MP-127, two identical requests reached the controlled provider and the first completed response never appeared.

## Decision

Start automatic translation when the selected text, initialization state, or target language codes change. An Effect Event reads the latest translation callback without making callback identity another request trigger. The explicit regenerate action still starts a new request, and a new action-window session remounts the component.

## Alternatives considered

- Waiting longer in E2E would leave the first response cancelled and preserve duplicate provider requests.
- Removing dependencies while retaining a captured callback would risk using stale language detection and lookup functions.

## Consequences

Callback refreshes preserve an active translation. A changed selection or language pair still requests a fresh translation. No persistence, provider protocol, or action-session ownership changes are needed.

## Verification

- Regression — the component test holds a real translation-hook request, refreshes the detection callback, and completes the first response. The visible-result assertion failed before the repair and passed afterward; changing the selected text then produces the new result.
- Regression — 36 tests passed across `ActionTranslate.test.tsx`, `useTranslate.test.tsx`, and `ActionWindow.test.tsx`, covering language selection, result rendering, cancellation, and action-session behavior.
- Regression — the real local MP-127 workflow passed in 31.4 seconds with capture, explain, translation and copy assertions.
