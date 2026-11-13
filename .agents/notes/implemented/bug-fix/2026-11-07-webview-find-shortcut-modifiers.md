# Agent Note: Preserve modified Find shortcuts outside webview search

Status: implemented

English | [中文](2026-11-07-webview-find-shortcut-modifiers.zh.md)

## Problem

With a webview mounted, Ctrl/Cmd+Shift+F opened both global search and the webview's Find overlay. The webview handler matched the modifier and F without excluding Shift or Alt, and its search input could take focus from global search. The full MP-129 run observed a focused Search input outside the global-search dialog.

## Decision

Webview Find handles Ctrl/Cmd+F only when Shift and Alt are absent. The same modifier rule applies to keys replayed from a guest. Existing pane ownership and ordinary Find, Enter and Escape behavior remain intact.

## Alternatives considered

Refocusing the global-search input in the E2E test or changing that test's shortcut would hide the conflicting product handler. Removing webview Find would lose normal browser search.

## Consequences

Modified Find combinations remain available to their owning features, while ordinary webview Find continues to work.

## Verification

- Regression — Four input-focus regressions fail before the fix and pass afterward for Ctrl/Cmd combined with Shift or Alt. All 59 focused webview-search, keyboard-replay and Mini App consumer tests pass. The real MP-122 → MP-129 sequence passes with a webview retained before opening global search. Full desktop and hosted acceptance remain tracked by the PR.
