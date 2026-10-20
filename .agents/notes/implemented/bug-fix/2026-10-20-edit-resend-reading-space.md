# Agent Note: Edit-and-resend reading space

Status: implemented

English | [中文](2026-10-20-edit-resend-reading-space.zh.md)

## Problem

Editing and resending a message can replace a long reply with a shorter branch. The reading freeze retained the old content extent, leaving excessive blank space. Clearing it on the first wheel gesture could clamp the viewport and cause a jump.

## Decision

Capture the reading position before the asynchronous write and bind the replacement key after success. Wait for the old branch to leave and measurements to settle. Preserve the reading position when content remains visible; otherwise position the edited user message at the top. Retain only the space required by that destination viewport.

Within a settled replacement, remaining space only decreases with upward user motion, new content growth, or reaching the top. Reclamation is bounded by committed layout below the viewport, so it cannot force a scroll-position clamp. Native thumb dragging pauses reclamation. Programmatic movement is excluded from user consumption. A new replacement starts a fresh budget; ordinary disclosure behavior remains separate.

## Alternatives considered

Keeping the old content height preserves excessive whitespace. Clearing all space at once moves the viewport. Debiting every upward scroll event also counts browser clamping and can cascade. Returning an empty viewport to the reply bottom hides the edited user message.

## Consequences

The list exposes a two-phase replacement callback through the existing runtime adapter. It adds no persisted state, settings, dependencies, or migration. Replacement measurement is cancelled when superseded. Physical touchpad and cross-platform behavior still require manual verification.

## Verification

- Regression — Renderer runtime, MessageVirtualList, and MessageList: 153 tests pass, covering minimal space, fractional motion, inertia, clamping, drag suspension, content growth, optimistic branch replacement, and consecutive edits.
- Regression — Electron component fixture with real virtua and Chromium input: a 120 px upward wheel movement moves the viewport by 120 px and reduces space from 300 to 180 px; an empty viewport lands on the edited message with 88 px remaining; PageUp releases the remainder.
- Regression — Renderer typecheck, scoped lint, and formatting pass. Full edit-request streaming/non-streaming flows were verified before the final interaction adjustment and are not claimed as final-revision end-to-end coverage.
