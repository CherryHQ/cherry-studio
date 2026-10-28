# Agent Note: Composer input history recall

Status: implemented

English | [中文](2026-10-28-composer-input-history-recall.zh.md)

## Problem

Plain Up/Down recalls previously sent composer text when the draft is empty, fully selected, or the caret reaches the existing history boundary. Users need to choose whether those keys intercept history navigation without changing stored history or ordinary movement inside text.

## Decision

`chat.input.history_recall` has three values: `arrow` uses plain Up/Down, `ctrl_arrow` uses the platform primary modifier with Up/Down, and `off` relinquishes history interception. The default remains `arrow` to preserve existing behavior for users who do not change the setting. The searchable Appearance input setting is independent of send, newline, and steer shortcut exclusions.

Both composer surfaces express the chord as an existing shortcut binding, using `CommandOrControl` for the platform primary modifier. `matchesComposerShortcut` normalizes arrow names and requires exact binding equality, rejecting additional modifiers. Only the chord boundary knows the policy values; the pure navigation guard receives a required boolean. Composition, QuickPanel visibility, selection, and boundary eligibility retain their existing rules.

The runtime reads the latest policy through a ref updated in its existing layout effect, so changing the setting updates the retained keyboard handler without recreating the editor. The lazy fallback uses the same guard but keeps its existing textarea boundary predicate; it does not attempt ProseMirror visual-line measurement.

## Alternatives considered

- Route history through the command/shortcut system: rejected because [CommandProvider.tsx:140](../../../../src/renderer/components/command/CommandProvider.tsx) skips unmodified shortcuts when an editable target is focused, and [useCommandContext.ts:6](../../../../src/renderer/hooks/command/useCommandContext.ts) declares no composer-focus context key. Changing that system would broaden this feature beyond composer history.
- Parse modifier flags locally: rejected because the existing matcher already owns platform normalization and exact chord matching.
- Change the default or promise caret movement when disabled: rejected. Existing users retain plain arrows, and disabling only relinquishes history interception; the editor and other handlers still own caret behavior.

## Consequences

History storage and draft restoration remain unchanged. The user can avoid plain-arrow interception or disable recall entirely. Only successful history navigation prevents the default event; the runtime also preserves its existing propagation stop, while the fallback does not add one. The two surfaces retain their different boundary capabilities.

## Verification

- Regression — Targeted renderer run: 6 suites, 289 tests passed, 0 failed (composer guard, runtime, lazy fallback, unresolved-runtime policy, settings row, and settings search).
- Regression — Renderer input matcher suite: 10 tests passed, 0 failed. Shared shortcut suite: 32 tests passed, 0 failed.
- Regression — Baseline guard probe: 6 controls passed and 6 expected failures (`expected true to be false`). Baseline surface policy cases: 6 expected failures; 173 unrelated tests skipped by the name filter.
- Regression — Renderer and E2E TypeScript projects passed with 0 errors. `i18n-check.ts` passed for 96,476 translations. Changed-file Oxlint, ESLint, formatting, and `git diff --check` passed; the Electron spec is ignored by lint configuration and checked by TypeScript and formatting. ESLint reported one ignored-file warning and 0 errors.
- Acceptance — Real Electron run of `tests/e2e/smoke/composerInputHistory.test.ts` (isolated profile, English UI): default recall, primary-modifier recall, disabled mode, a live mode switch without remounting the editor, and relaunch persistence all behave as specified.
