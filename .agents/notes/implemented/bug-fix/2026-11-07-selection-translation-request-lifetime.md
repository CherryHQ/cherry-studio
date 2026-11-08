# Agent Note: Keep selection translation tied to its inputs

Status: implemented

English | [中文](2026-11-07-selection-translation-request-lifetime.zh.md)

## Problem

The selection translation effect depended on a callback whose identity changed when language detection and language lookup refreshed. An unchanged selection could therefore cancel its first request and start another. In MP-127, two identical requests reached the controlled provider and the first completed response never appeared.

If the quick model arrived after the saved languages, the first detection could fail and select the fallback target permanently. Model readiness must remain a semantic input for model-assisted detection even when callback refreshes are ignored. Making it unconditional also cancelled offline `franc` translations when an unrelated quick model loaded or changed.

## Decision

Start automatic translation when the selected text, initialization state or target language codes change. The quick-model ID also triggers translation for `llm` and `auto` detection, while `franc` ignores it. An Effect Event reads the latest translation callback without making callback identity another request trigger. The explicit regenerate action still starts a new request, and a new action-window session remounts the component.

## Alternatives considered

- Waiting longer in E2E would leave the first response cancelled and preserve duplicate provider requests.
- Removing dependencies while retaining a captured callback would risk using stale language detection and lookup functions.
- Removing quick-model readiness entirely would regress late model-assisted detection and target correction.

## Consequences

Callback refreshes preserve an active translation. A changed selection or language pair still requests a fresh translation. A late quick model recomputes the target in model-assisted detection, while refreshing the same model record preserves the active request. Offline detection retains its active translation when the quick model loads or changes. No persistence, provider protocol, or action-session ownership changes are needed.

## Verification

- Regression — the component test holds a real translation-hook request, refreshes the detection callback, and completes the first response. The visible-result assertion failed before the repair and passed afterward; changing the selected text then produces the new result.
- Regression — an earlier real local MP-127 workflow passed in 31.4 seconds with capture, explain, translation and copy assertions.

- Regression — 60 tests passed across the action component, detection hook, translation hook and action window. The real detection-hook probe failed before the model-ID dependency and passed afterward: a late model corrects the Chinese fallback to the English alternate without requiring Regenerate.

- Regression — the offline-detection case failed before mode gating: completing the original request after quick-model hydration left the result absent and the controls disabled. It now renders that result and exits the streaming state. The latest full MP-127 run observed duplicate requests without recording the quick-model transition; its exact trigger and the fresh Electron rerun remain separate verification work.
