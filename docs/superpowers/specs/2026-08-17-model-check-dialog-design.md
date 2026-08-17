# Model Check Dialog Design

## Goal

Restore the initial model-check dialog to the content and visual structure used by `main` while retaining the
current branch's model-check execution, credential, skip-rule, and result behavior. Selecting “Check all models”
must replace the content inside the existing dialog instead of closing it and opening another surface.

## Scope

- Change the model-check dialog presentation and its focused renderer tests.
- Keep the API-key-row trigger and its current local styling unchanged.
- Reuse existing translations; do not add or change user-visible wording.
- Do not restore the deleted `ProviderConnectionCheckDrawer` or `HealthCheckDrawer` contracts.
- Do not change health contexts, detection hooks, persistence, or model-list result rendering.

## Dialog Views

### Initial single-model view

The dialog opens in the single-model view every time. It matches the former `main` dialog structure:

- use the connection-check title and the 520 px dialog width;
- show a labeled model combobox with model avatars and the established compact control styling;
- show a concrete enabled API key selector when multiple selectable keys exist;
- show the only enabled key as a masked, read-only value when exactly one exists;
- omit the key selector when the provider's credential policy does not permit key selection;
- show the established connection-error detail card after a failed check;
- place “Check all models” at the left side of the footer, with Cancel and Start at the right.

Models that the current implementation intentionally skips remain unavailable for a single-model probe. This
preserves the current safety contract even though the surrounding presentation follows `main`.

Starting a single-model check calls the existing `startSingleModelCheck` with the selected model and one selected
key. Providers using non-key authentication continue through the existing credential policy. A passing check keeps
the current behavior of closing the dialog; a failed check remains open and displays the current serialized error
through the restored error-card presentation.

### All-model form view

Selecting “Check all models” changes the view state without changing the Dialog instance or open state. The view
uses the current branch's all-model form and behavior:

- show the stronger all-model cost warning;
- preserve the all/single API-key scope control and effective-key fallback;
- preserve concurrent execution and the explanatory hint;
- preserve the timeout input and its 5–60 second clamping;
- use Cancel and Start actions for this view.

A successful `startHealthCheck` closes the dialog and leaves progress and results in the existing model-list
surfaces. If the run does not start, the form remains visible. Reopening the dialog returns to the single-model
view; existing all-model form state retains its current component-lifetime behavior.

## State and Ownership

`ModelCheckDialog` owns only presentation state: the active view, selected model/key, all-model key scope,
concurrency, timeout, and the in-flight start guard. `useModelListHealthRun` remains the owner of detection state,
credentials, results, and dialog visibility.

The view-transition action is disabled while a single-model start is in flight. Existing context guards continue
to prevent overlapping single-model and all-model checks.

## Error Handling

The single-model error card derives its text from the failed result for the selected credential and opens the
existing error-detail popup with the serialized error. Missing required credentials disable Start. Unsupported-only
model lists retain the current disabled and empty-state behavior. Batch-start failures use the current health-check
path unchanged.

## Verification

Focused component tests will prove the following observable contracts:

1. The initial dialog exposes the `main` single-model controls and footer actions, without the current segmented
   model-scope control or batch warning.
2. Selecting “Check all models” keeps one dialog open and replaces its content with the current all-model form.
3. Single-model Start passes the selected model and one selected enabled key to `startSingleModelCheck`.
4. All-model Start preserves the current key selection, concurrency, and clamped timeout arguments.
5. A single-model failure uses the restored error presentation while current detection state remains authoritative.

Tests will use roles, labels, and visible text rather than Tailwind class assertions. The tracked Electron instance
will be used to compare the rendered dialog against `main` at the relevant window size and theme. Repository-required
lint, test, and format gates will run before completion.
