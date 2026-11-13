# Agent Note: Let Virtua own message-list bottom scrolling

Status: implemented

English | [中文](2026-11-09-message-list-programmatic-scroll.zh.md)

## Problem

The Virtua integration introduced in PR #14997 followed new messages by writing `scrollTop` from the DOM's estimated `scrollHeight`. Appending unmeasured rows could overshoot the final bottom. Virtua treated that write as ordinary scrolling, dropped the buffer behind the direction of travel, and unmounted historical messages before restoring them at scroll end. This lost local disclosure state and restarted code rendering; message memoization could not preserve an unmounted instance.

## Decision

Delegate bottom following to `VirtualizerHandle.scrollToIndex(lastIndex, { align: 'end' })`, as the official Virtua chat example does. Virtua then owns the programmatic scroll and pending measurement reconciliation. Preserve the existing following/reading ownership and native geometry checks. Upgrade Virtua from 0.49.1 to 0.54.2 without a package patch.

Explicit return-to-bottom navigation, including sending from history and the composer button, uses the same call with `smooth: true`. While it animates, automatic following must not issue instant scrolls. Once it settles, reconcile any content growth through another native smooth scroll, then resume ordinary following. Wheel, keyboard, or scrollbar input cancels the pending animation before taking reading ownership.

## Alternatives considered

- Upgrade alone: unmodified 0.54.2 still reproduces the direct-scroll state loss.
- Patch the library to keep both buffer sides: it hides the symptom while leaving the application outside the programmatic-scroll API.
- Keep every historical message mounted or add memoization: neither addresses the incorrect scroll ownership.
- Animate raw DOM offsets for bottom navigation: it bypasses Virtua's pending-measurement handling. Use its built-in smooth option instead.

## Consequences

Home and Agent lists share the corrected call. Virtua retains its normal bounded virtualization and buffer policy. User scrolling, reading anchors, explicit navigation animation, and selection retention retain their existing owners.

## Verification

- Regression — `chatVirtualizerRuntime.integration.test.tsx` uses the real runtime and Virtua: an expanded history disclosure survives an appended turn and measured bottom following. Restoring the old direct scroll resets it to collapsed.
- Electron — on unpatched 0.54.2, a five-variant comparison separates raw DOM scrolling from the official API, with fixed and automatic estimates. Both official API variants retain all eight history instances; changing the estimate alone does not solve the raw-scroll case.
- Electron — sending into the existing four-turn conversation and receiving four mock stream chunks retains all eight original message DOM instances with zero historical `MessageItem` unmounts after the application fix.
- Regression — `chatVirtualizerRuntime.test.tsx` verifies that bottom navigation does not jump immediately or when content grows, resumes following after reaching the new bottom, and stays in reading mode after user interruption.
- Electron — native button clicks and Enter submission from history produce intermediate offsets before reaching the bottom. An upward wheel during the animation cancels it and leaves the viewport in history. The three scenarios are recorded in the isolated development profile.
