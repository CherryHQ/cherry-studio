# Agent Note: Refresh knowledge note imports after directory mutations

Status: implemented

English | [中文](2026-11-07-knowledge-note-tree-refresh.zh.md)

## Problem

MP-63 opens the note-import picker before creating a note. Reopening it can still show the empty state because the directory mirror mutates the same root object while the picker memoizes only by root identity and path. Renamed and deleted notes can likewise remain stale.

## Decision

Include the directory subscription version in the projected file-list memo dependencies, matching other directory-tree consumers. Keep selection and import behavior unchanged.

## Alternatives considered

- Reloading the application in E2E would conceal the stale picker.
- Recreating the directory subscription on every dialog open would add filesystem work and discard the existing live mirror.

## Consequences

New, renamed and deleted notes are reflected after each directory mutation. No database or saved-note format changes are required.

## Verification

- Regression — a retained root is mutated through create, rename and delete events; the picker must show the current selectable files. The new test failed before the fix.
- Regression — all 35 AddKnowledgeItemDialog tests passed after the fix. Electron MP-63 passed with the live directory-mutation flow.
