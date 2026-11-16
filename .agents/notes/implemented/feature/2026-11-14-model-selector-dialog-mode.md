# Agent Note: Dialog mode for primary model selectors

Status: implemented

English | [中文](2026-11-14-model-selector-dialog-mode.zh.md)

## Problem

The anchored model dropdown leaves limited room for browsing long model lists. A larger dialog helps primary conversation and painting entry points, but applying a remembered dialog choice to embedded form fields interrupts those forms.

## Decision

`ModelSelector` defaults to a dropdown. Only assistant conversation controls, agent conversation controls and the painting composer enable `allowPresentationSwitch`; their footer toggles between the dropdown and a 560px-wide, up-to-560px-high dialog. Other consumers, including forms and translation, expose no toggle and ignore the saved dialog choice.

Both containers reuse the same selector panel and parent-owned selection, search and filter state. The renderer persist cache key `ui.model_selector.presentation` remembers the primary-entry choice, defaulting to `popover`. Form selectors neither apply nor overwrite that choice. No database migration is needed.

The dialog centers below the navbar with at least 16px clearance and shrinks to the available viewport. Model details portal inside the active dialog; container switches do not restore focus to an obsolete trigger. Footer actions fill the remaining width with inset rounded hover feedback, and utility icons inherit semantic foreground states.

A `PageSidePanel` handles Escape only when its own dialog owns the event and the event has not already been handled. React-portal events from a child dialog must not close the underlying panel and discard its draft.

## Alternatives considered

- Enable dialogs everywhere: rejected because saved primary-entry choices must not change embedded form behavior.
- Create a native window or a second model list: rejected because window synchronization and duplicated selection logic are unnecessary for this presentation change.
- Handle the knowledge-panel Escape conflict in the selector: rejected because the side panel owns dismissal and must respect nested dialog boundaries.

## Consequences

Primary selectors share one remembered presentation preference; auxiliary selectors remain dropdowns. Switching containers may reset container-local scroll or hover state while preserving the selection, search and filters. The user explicitly requested direct implementation without proposal review for this change.

## Verification

- Regression — `ModelSelector.presentation.test.tsx`: real dialog/popover primitives preserve search and focus across switches, remember the mode after remount, and keep forms in dropdown mode without overwriting a saved dialog choice.
- Regression — `page-side-panel.nested-dialog.test.tsx`: Escape dismisses a real child dialog while leaving the panel usable; the next Escape can close the panel.
- Regression — focused model selector, Cloud wrapper, agent controls and painting selector tests: 5 files, 22 tests passed; focused side-panel tests: 2 files, 18 tests passed.
- Regression — Electron: all three primary entry categories retain switching; four default-model setting fields, agent creation and translation stay dropdown-only under a saved dialog choice; a 520x420 viewport leaves 16px clearance below the navbar and keeps the footer visible.
- Regression — Electron consumer checks cover knowledge, assistant/agent editing, CLI configurations, MiniApp model slots, Doctor and message model selection; final scope checks confirm auxiliary consumers have no mode controls. First-run onboarding and knowledge restore use component coverage rather than replaying those workflows.
