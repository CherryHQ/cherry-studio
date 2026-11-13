# Agent Note: Preserve active text inputs when the rich editor loads

Status: implemented

English | [中文](2026-11-07-rich-editor-autofocus.zh.md)

## Problem

N-01 intermittently lost its note-name input between typing and pressing Enter. Delaying the real rich-editor module reproduced the problem: mounting the editor moved focus away from the active rename input, triggering its blur-to-save behavior and unmounting it.

## Decision

Before automatic focus on creation or after becoming editable, the shared rich editor checks whether another text input or editable surface currently owns focus. It preserves that active input while retaining automatic focus when no other text editor is active.

## Alternatives considered

Waiting for the note editor before renaming would hide a real user interaction race. Removing automatic focus entirely would degrade normal note creation.

## Consequences

Slow editor loading no longer interrupts an active rename or other text input. Explicit user focus commands are unchanged.

## Verification

- Regression — Two real-editor component cases fail before the fix and pass afterward, covering mount and editability changes. All 31 related rich-editor tests pass.
- Desktop — The same controlled delayed-module Electron reproduction changes from a removed rename input to a visible, focused input. Full regression and hosted acceptance remain tracked by the PR.
