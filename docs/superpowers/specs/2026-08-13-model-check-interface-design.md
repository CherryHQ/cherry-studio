# Model Check Interface Design

Date: 2026-08-13

## Context

Cherry Studio currently exposes two closely related model-probe workflows in provider settings:

- a single-model connection check launched from the API key field; and
- an all-model health check whose configuration, progress, and results live in a side drawer.

Users have difficulty discovering the all-model workflow and acting on its results. The drawer separates failed
models from the model list where they can be edited or removed, and aggregated failures do not make it easy to
identify or disable a failing API key. This design covers the original request plus
[#17935](https://github.com/CherryHQ/cherry-studio/issues/17935) and
[#18434](https://github.com/CherryHQ/cherry-studio/issues/18434).

## Goals

- Present one clearly named `Model Check` entry point in the model-list toolbar.
- Use one dialog for choosing between a single-model check and an all-model check.
- Preserve the current v2 single-model result behavior while restoring the v1.9-style all-model result workflow.
- Keep all-model progress and results next to the affected models so users can edit or remove failures in place.
- Expose per-key results and allow a failing API key to be enabled or disabled directly from the report.
- Keep the change inside renderer Provider Settings by reusing current probe, persistence, and enablement contracts.

## Non-goals

- Adding health probes for image, video, audio-generation, speech-to-text, or text-to-speech models.
- Changing the `ai.provider.model.check` IPC route, main-process probe dispatch, database schema, or shared data
  contracts.
- Replacing the existing full API Key Management interface. The model-check report only exposes enablement.
- Persisting model-check reports across provider changes, navigation, or application restarts.
- Changing search, capability-filter, or group-expansion state when a check starts.

## Product language

The user-facing canonical term is **Model Check** (`模型检测`). The interface must not present separate Health
Check and Connection Check actions. Internally, the implementation may retain separate single-model and all-model
runners because they have different observable behavior.

## Entry point

- Remove the model-check icon action from the API key input row.
- Remove the existing `Check all models` action from the single-model dialog.
- Add a secondary text button with an Activity icon to the model-list toolbar, immediately before `Get model list`.
- Label the button `Model Check` (`模型检测`).
- During an all-model run, replace its icon with a spinner, label it `Checking…`, and disable it.
- Do not provide a second model-check entry point elsewhere on the provider page.

## Unified dialog

The toolbar button opens one dialog with `Single model` and `All models` modes. Every open starts in `Single model`
mode. Switching modes preserves each mode's form state and temporary result independently.

A result becomes stale and is cleared when its own model or key selection changes, a new run starts, the underlying
credentials change externally, the provider changes, or the page unmounts. Merely switching modes does not clear
either mode's state. Disabling a key from a displayed report does not erase the report.

Both modes show the existing warning that probes make real requests and may incur charges.

### Single-model form

- Model selector:
  - sort models by display name;
  - initially select the first checkable model;
  - keep unsupported models visible but disabled, with a reason;
  - disable Start with an explanatory empty state when no model is checkable.
- Key scope:
  - default to all enabled API keys;
  - allow switching to one enabled API key;
  - show a key selector only for single-key scope when more than one key is available;
  - hide key controls for keyless providers and run with the existing empty-key behavior.
- Do not expose concurrency or timeout controls. Use the current fixed 15-second timeout.
- State how many enabled keys the run will use in the warning or adjacent supporting text.

### All-model form

- `All models` means every model in the selected provider, regardless of model enablement, search, capability filter,
  or collapsed groups.
- Replace the model selector with a preflight summary: `X models will be checked; Y will be skipped`.
- Explain before Start that generation models are skipped to avoid higher-cost output generation and speech models
  are skipped because no reliable low-cost probe exists.
- Use the same key-scope controls as single-model mode, defaulting to all enabled keys.
- Show model concurrency, enabled by default. It controls concurrency between models; keys for one model remain
  concurrent.
- Show timeout in seconds, defaulting to 15 and constrained to 5–60.

### Unsupported models

Keep the current v2 probe boundary:

- text, embedding, and rerank models use their current probe paths;
- image, video, and audio-generation models are skipped because an appropriate probe would generate paid output;
- speech-to-text and text-to-speech models are skipped because no reliable low-cost probe exists.

Single-model options in the latter two groups remain visible but cannot be selected. All-model runs include them in
the skipped count and later show a skipped result on their model rows. Extending main-process probes is a separate
feature.

## Credential preparation

Opening the model check from the toolbar can blur an API key field whose debounced save has not completed. Before a
run sends requests, it must commit the current edited credentials and then use the latest enabled-key snapshot.

- If the save fails, do not start a probe and keep the dialog open with the existing save-failure feedback.
- Providers that require authentication cannot start without an enabled key.
- Keyless providers keep the existing empty-key behavior and do not show key controls.
- Disabled keys are not offered for selection and never participate in a new run.

## Single-model run and results

Single-model mode preserves the current v2 result location and lifecycle.

1. Start validates the form, saves pending credentials, and shows a loading state on the dialog's Start button.
2. The dialog remains open while all selected keys are probed concurrently.
3. If every key succeeds, attempt the existing provider auto-enable follow-up, close the dialog, and show the
   existing success feedback.
4. If any key fails, keep the dialog open and replace or augment the form with a per-key report.
5. If at least one key succeeds, the provider connection is usable and the existing auto-enable follow-up may run;
   failed keys remain visible in the report.
6. Auto-enable failure produces a warning but never changes a successful probe result into a failure.

The report shows, for every participating key:

- label, or the localized unnamed fallback;
- masked key value;
- Passed, Failed, or Disabled status;
- latency for success;
- the complete serialized error message for failure; and
- an enablement switch.

It does not expose copy, edit, or delete actions. Those remain in API Key Management.

## All-model run and row results

All-model mode restores the v1.9 interaction shape without restoring v1 code.

1. Start validates and saves credentials, builds this run's initial model states, then immediately closes the
   dialog.
2. The toolbar button enters its checking state, and every checkable target row starts in `Checking` state.
3. Models update incrementally as their probes settle.
4. Completion shows one short toast summarizing passed, partially passed, failed, and skipped counts.
5. The report stays in the model list until a new run replaces it, the provider changes, or the page unmounts.
6. No side drawer or secondary result dialog opens.

Model rows display:

- **Checking**: spinner and localized checking label.
- **Passed**: success icon, Passed label, and the fastest successful latency when available.
- **Partially passed**: warning icon and `x/y keys failed` when at least one key passes and at least one fails.
- **Failed**: error icon, Failed label, and the first error summary truncated to one line when all participating
  keys fail.
- **Skipped**: neutral info icon and Skipped label.

The whole status control is keyboard focusable and opens an anchored Popover. The Popover uses a portal so it does
not change the fixed height of virtual model rows. It contains the same per-key report and switches used by the
single-model result. A skipped row opens the same surface with its complete skip reason.

Search text, capability filters, and collapsed groups remain unchanged. A run may therefore have results on a model
that is temporarily not visible; the toolbar loading state still communicates that the run is active, and the row
result appears when the user makes it visible.

## API key enablement from results

- Toggling a key updates the provider's existing API-key entry through the current mutation.
- A successful update keeps the current run result and marks a newly disabled key as Disabled; the next run excludes
  it.
- A failed update rolls the switch back and shows the existing save-failure feedback.
- Re-enabling is allowed from the same report, but does not automatically rerun the check.
- No enablement change triggers a paid probe.

## Run coordination and cancellation

Only one model check may run for a provider at a time.

- During any active run, disable the toolbar Model Check button and model-changing operations: fetch, add, edit,
  delete, and group/bulk actions.
- Search, filtering, and group expansion remain available.
- Starting a new run replaces the previous run's results.
- Provider changes and unmount abort the active request and prevent stale callbacks from updating the new page.
- Closing the dialog during a single-model run only hides it, matching current v2 behavior; it does not abort the
  probe. The toolbar remains disabled, completion still produces its normal feedback, and reopening restores a
  failed per-key report. Provider changes and unmount remain the cancellation boundaries.
- An all-model run has no explicit mid-run Cancel action because its dialog has already closed.
- Deleting a model after an all-model run removes that model and its report together after deletion succeeds. A
  failed deletion keeps both visible and uses existing failure feedback.

## Component and state boundaries

Use current `@cherrystudio/ui` primitives. The feature remains inside Provider Settings and retains consumer-owned
state.

- A unified dialog component owns only mode-specific form and temporary single-model result presentation.
- The single-model runner retains credential commit, provider auto-enable, v2 success close, and failure-in-dialog
  semantics.
- The all-model runner retains model status collection, incremental callbacks, cancellation, and list result state.
- Shared feature-local presentation renders per-key results in the dialog and model-row Popover without adding a
  public design-system component.
- The model-list health contexts remain split so frequent per-model updates do not rerender the entire list
  unnecessarily.

This approach unifies the user entry point and configuration without forcing observably different workflows into a
single runner.

## Error handling

- Form and credential errors stay in the dialog and prevent Start.
- A single-model probe failure stays in the dialog with complete key-level details.
- An all-model per-key probe failure becomes a model-row result and does not reject the whole run.
- A pipeline-level failure logs through `loggerService`, ends the loading state, and shows the existing localized
  start-failure feedback while preserving results already received.
- Abort is control flow and must not show an error toast.
- API key mutation and provider enablement failures use their existing feedback and rollback semantics.

## Accessibility and visual behavior

- Use semantic success, warning, error, and neutral tokens; status must also include an icon and text rather than
  rely on color.
- Unsupported model options expose a readable reason.
- Status triggers have accessible names containing the model result and support keyboard activation.
- Popover content is reachable by keyboard, its switches have key-specific accessible labels, and Escape closes it.
- Long model names, masked keys, and error summaries truncate only in compact rows; the detail report exposes full
  error text.
- The toolbar button and dialog actions use their shared loading and disabled states.

## Tests and verification

Behavior tests must establish contracts rather than pin component internals.

### Dialog and single-model tests

- one toolbar entry point opens the unified dialog in single-model mode;
- API-key-row entry point and old cross-dialog action are absent;
- first checkable sorted model and all enabled keys are the defaults;
- unsupported options are visible but disabled with reasons;
- keyless provider form and run use the empty-key path;
- pending credentials commit before probes; save failure prevents probes;
- all-success closes with success feedback;
- partial or total failure stays open with per-key details;
- switching modes preserves valid state, while changing a selection clears only its stale result;
- provider auto-enable runs when at least one selected key succeeds, and enablement failure does not rewrite results.

### All-model and row-result tests

- all provider models are included regardless of current UI filters;
- unsupported models become skipped entries and are not probed;
- concurrency and timeout are forwarded correctly;
- configuration success closes the dialog and row states update incrementally;
- passed, partial, failed, skipped, and checking states expose their promised text and icon semantics;
- failure summary truncation retains access to complete details;
- the Popover exposes key-level results without changing virtual-row height;
- a successful key toggle persists and remains marked Disabled; a failed toggle rolls back;
- a new run replaces old results; provider change/unmount aborts stale work;
- model mutations are disabled during the run while search/filter/expansion remain usable;
- successful model deletion removes its report and failed deletion preserves it.

### Verification commands

Run the closest Provider Settings Vitest projects during implementation. Before completion, run the repository-required
checks:

1. `pnpm lint`
2. `pnpm test`
3. `pnpm format`
4. `pnpm build:check` before committing implementation

Run `pnpm test:lint` when preparing CI-ready work if the standard commands do not cover the CI warning gate.

## Documentation decision

No ADR is needed. The decision is feature-local, reversible, and does not change shared infrastructure or a
cross-process contract. The canonical product term is recorded in the root `CONTEXT.md` glossary.
