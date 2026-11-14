# Agent Note: Preserve the composer's manually chosen height during paste

Status: implemented

English | [中文](2026-11-09-composer-manual-height.zh.md)

## Problem

The composer's auto, manual and expanded display modes share the `manualHeight` sizing state. The paste handler in `src/renderer/components/composer/ComposerSurfaceRuntime.tsx` calls `fitContentHeight()` before routing the clipboard content. Without a manual-mode guard, that function in `src/renderer/components/composer/useComposerEditorFrameSizing.ts` unconditionally clears `requestedManualHeight` and exits expanded mode. A long paste therefore discards the height chosen with the top resize handle, returns the frame to auto-fit and lets content beyond the available height cover the message list (Issue #23966).

PR #21595 deliberately chose automatic fitting after paste, including after manual resizing. User-chosen dimensions take precedence over that earlier choice in manual mode.

## Decision

A manually chosen height is a user constraint. Typing and every paste preserve it; overflow scrolls inside the frame's ScrollArea viewport. Only an explicit restore, expansion, another adjustment with the resize handle, or a smaller available-height limit changes that height.

`fitContentHeight()` returns immediately when `!isExpanded && requestedManualHeight !== null`. Its existing cleanup runs only when expanded or when no manual height is requested. Pasting while expanded still returns to auto-fit. The `!isExpanded` condition is required: `toggleExpanded(true)` retains `requestedManualHeight`, so checking only for a non-null height would also change expanded-mode paste behavior.

## Alternatives considered

- Gate the paste call site: spreads the height policy into consumers instead of keeping it in the sizing hook.
- Add a call-source parameter to `fitContentHeight()`: there is no second consumer requiring a different policy, so the interface would be speculative.
- Preserve manual height but shrink automatically when content becomes shorter: makes dimensions unstable and contradicts manual height as a constraint.

## Consequences

A large manually sized frame no longer shrinks automatically after a short paste; explicit restore returns it to auto-fit. Dynamic clamping to `maxHeight` and the expanded/restore state transitions remain unchanged. Auto mode has no behavior change.

## Verification

- Regression — `src/renderer/components/composer/__tests__/useComposerEditorFrameSizing.test.tsx`: fitting preserves the first and successive manual adjustments and a manually chosen maximum; expanded paste returns to auto even after manual sizing followed by expansion. Available-height shrinkage still clamps the manual frame.
- Regression — `src/renderer/components/composer/__tests__/ComposerSurface.test.tsx`: a real editor preserves the complete large pasted text and selection replacement, while the manual restore control remains available after the long paste.
- Regression — `tests/e2e/smoke/composerManualHeight.test.ts`: one real Electron smoke uses the mouse resize handle, native clipboard paste and keyboard input; the frame's height and top stay within 1 px of the manual baseline, its position relative to a reference message stays stable, and the internal viewport scrolls with the wheel. As a counterexample, after restore and clearing the draft, pasting the same long text without a manual height still grows the frame to its maximum and then scrolls inside it.
