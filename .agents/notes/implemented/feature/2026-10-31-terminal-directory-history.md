# Agent Note: Terminal directory history

Status: implemented

English | [中文](2026-10-31-terminal-directory-history.zh.md)

## Problem

Remembering only the last terminal working directory makes switching between projects require repeated folder picking.

## Decision

Local Agents share their terminal working directory and history through `feature.code_cli.workspace`. Launching moves the selected directory to the front without duplicating it. Before the first shared write, the dialog combines legacy histories and prefers the current tool's saved directory. A legacy directory seeds history only if its tool had no history field.

The input's dropdown selects a directory or removes an individual history entry. Removing an entry saves immediately and changes neither the current selection nor files on disk. Canceling the dialog does not undo an explicit history removal. Folder and terminal choices otherwise remain saved at launch.

## Alternatives considered

- Per-tool histories require users to pick the same project again when switching Agents.
- Storing the workspace alongside per-tool launch settings would couple directory edits to provider and terminal configuration.

## Consequences

No database migration is required. Terminal applications remain per tool. Reusing a removed directory for another launch adds it back to the shared history.

## Verification

- Regression — `LocalAgentTerminalDialog.test.tsx`: selecting history launches in that directory, moves it to the front, and does not duplicate it.
- Regression — `LocalAgentTerminalDialog.test.tsx`: launch in one Agent and verify another opens with the same directory and its own terminal application.
- Regression — `LocalAgentTerminalDialog.test.tsx`: removing a legacy folder prevents it from returning in another Agent's history and keeps the current directory.
