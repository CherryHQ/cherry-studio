# Agent Note: Preserve selection actions across input gestures

Status: implemented

English | [中文](2026-11-07-selection-gesture-handoff.zh.md)

## Problem

A keyboard selection can begin in the same animation frame as a mouse selection ends. The keyboard handler cancels the pending pointer-release frame, leaving the toolbar in its mouse-dragging state. A subsequent selection-change event hides Copy and Quote despite a completed nonempty message selection.

## Decision

Clear the pointer-selection state when a keyboard selection starts. The existing keyboard-key tracking then owns completion, measurement and scroll handling.

## Alternatives considered

- Adding an E2E delay would hide the same timing failure available to users.
- Running the cancelled pointer callback would show actions during an unfinished keyboard selection.

## Consequences

Pointer-only selection, editable-content exclusion, scroll dismissal and keyboard modifier tracking keep their existing behavior. No persistence or IPC changes are needed.

## Verification

- Regression — a test begins keyboard selection immediately after pointer release, completes it and delivers the final selection-change event. It failed before the fix and passed afterward.
- Regression — all 11 selected-text toolbar tests passed, including copy, quote, exclusion, scrolling, modifier release and dismissal contracts.
