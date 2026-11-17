# Agent Note: Restore code highlighting when rich-editor plugin views restart

Status: implemented

English | [中文](2026-11-10-rich-editor-highlight-view-lifecycle.zh.md)

## Problem

The macOS MP-74 regression rendered and saved Markdown correctly but found no syntax tokens in its code block. A controlled reproduction confirmed a product lifecycle defect: registering another ProseMirror plugin while a code-block highlight request is pending can leave the current document permanently unhighlighted.

ProseMirror recreates plugin views when plugins are registered or removed, retaining their editor state. The highlighter's old view clears its block sessions on destruction, but the replacement view previously relied on state initialization to discover blocks. State initialization does not repeat for a retained plugin, so the replacement had no blocks to highlight. The rich editor dynamically registers its insertion toolbar through this same API.

## Decision

Each new highlighter view reconciles code blocks from its current document before requesting syntax tokens. Destruction still closes the old sessions, and their late results remain ignored. Code text, selection, serialization, undo history and the worker protocol keep their existing contracts.

## Alternatives considered

Increasing MP-74's timeout or accepting unhighlighted code would hide a persistent product failure. Keeping old view sessions alive would retain obsolete work and make teardown ownership ambiguous. Reusing the existing document reconciliation restores the new view without adding retries or another lifecycle mechanism.

## Consequences

Plugin registration and removal no longer discard pending code highlighting. The replacement view opens fresh sessions for current blocks, so unchanged blocks can be parsed again during a plugin-view restart. Ordinary transactions retain the existing incremental behavior.

## Verification

- Regression — The focused real-editor test replaces code while highlighting is pending, registers another plugin, edits again, and removes the plugin. It fails before the fix and passes afterward; the rich-editor and highlighting-service files pass 16 tests together.
- Regression — The same controlled operation in a tracked macOS Electron Notes editor produces zero token spans before the fix and 14 afterward, preserving the code text. This establishes the lifecycle defect; it does not reconstruct every scheduling event in the original hosted run.
