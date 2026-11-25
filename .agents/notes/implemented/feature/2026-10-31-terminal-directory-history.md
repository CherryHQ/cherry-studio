# Agent Note: Terminal directory history

Status: implemented

English | [中文](2026-10-31-terminal-directory-history.zh.md)

## Problem

Remembering only the last terminal working directory makes switching between projects require repeated folder picking.

## Decision

The local Agent terminal dialog stores per-tool `directoryHistory` alongside `directory` in `feature.code_cli.configs`. Launching moves the selected directory to the front without duplicating it. Existing configurations without history expose their saved directory as the initial history entry; an explicitly empty history stays empty.

The input's dropdown selects a directory or removes an individual history entry. Removing an entry saves immediately and changes neither the current selection nor files on disk. Canceling the dialog does not undo an explicit history removal. Folder and terminal choices otherwise remain saved at launch.

## Alternatives considered

- A global history would mix unrelated Agent projects; keep the existing per-tool settings ownership.
- A separate preference or database table would add storage machinery for a list already owned by terminal settings.

## Consequences

No database migration or new preference key is required. Reusing a removed directory for another launch adds it back to history.

## Verification

- Regression — `LocalAgentTerminalDialog.test.tsx`: selecting history launches in that directory, moves it to the front, and does not duplicate it.
- Regression — `LocalAgentTerminalDialog.test.tsx`: deleting legacy history persists across reopening without changing the selected directory or another tool's settings.
- Regression — Electron: selected and removed a Chinese path containing spaces, reopened the dialog, and checked light and dark appearances; temporary test preferences were restored.
