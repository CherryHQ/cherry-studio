# Model Check Regression Fixes Design

Date: 2026-08-14

## Context

The `codex/model-check-interface` branch unifies the provider connection check and all-model health check behind one
Model Check dialog. Review found correctness and interaction regressions in the new implementation, but also surfaced
several issues that already exist on `origin/main`.

This design applies a strict attribution boundary: only regressions introduced by the current branch, or integration
failures caused by its new consumers, are in scope. Existing `main` behavior is not opportunistically repaired.

## Historical contract

`origin/main` and `v1.9.13` establish the credential behavior that this branch must preserve:

- enabled API keys are passed explicitly to a probe;
- single-key and all-key modes operate on the selected key values;
- when no API key is available for a keyless provider, the probe receives an explicit empty string;
- an absent override must not be used as a substitute for keyless probing, because Main interprets `undefined` as a
  request to select or rotate an enabled stored key.

The branch keeps its stable API-key identities and result enablement controls, but restores those transport semantics.
No Main-process, IPC, persistence, or provider-registry contract changes are required.

## Goals

- Restore `main`/v1.9 credential semantics for required-key, optional-key, and login-based providers.
- Prevent a completed single-model run from closing or populating a form whose model or key selection changed while
  the run was active.
- Restore visible all-model preparation failures.
- Make the new dialog usable with long result lists, unsupported-only model sets, keyboard navigation, and assistive
  technology.
- Keep fixes limited to APIs, components, translations, and tests introduced or newly consumed by this branch.

## Non-goals

- Expanding cancellation fingerprints to Azure `apiVersion`, AWS credentials, Vertex credentials, or other provider
  configuration that `origin/main` does not currently observe.
- Changing the existing `checkModelsHealth` abort logging behavior.
- Performing a repository-wide reduced-motion cleanup or changing existing Button/Switch loading primitives.
- Changing Main API-key rotation, `ProviderService.resolveApiKey`, IPC schemas, or shared persistence contracts.
- Reworking the default filtering contract of the shared Combobox for existing consumers.
- Removing public Model List APIs that already exist on `origin/main`.

## Credential policy

The current `requiresApiKey` boolean incorrectly represents two independent questions. The feature will model them
separately:

- `requiresApiKey`: starting without an enabled API key is invalid;
- `canSelectApiKey`: configured API keys may be selected and passed explicitly.

The policy is derived inside Provider Settings from the merged provider and existing API-key field metadata. A
login-based provider cannot select API keys even if the generic metadata would otherwise report the field as visible.

| Provider category | Enabled keys | Requires key | Can select key | Probe credentials |
| --- | --- | --- | --- | --- |
| Login-based or non-API-key authentication | Any | No | No | Provider authentication with explicit empty key override |
| `authOptional` | One or more | No | Yes | Explicit selected key or all enabled keys |
| `authOptional` | None | No | Yes | Provider authentication with explicit empty key override |
| Required API-key provider | One or more | Yes | Yes | Explicit selected key or all enabled keys |
| Required API-key provider | None | Yes | Yes | Start is blocked with the existing missing-key feedback |

`resolveModelCheckCredentials` will use both policy dimensions. It will inspect enabled entries when key selection is
supported, preserve the current stable entry IDs, and only fall back to provider authentication when the provider does
not require a key and no selectable key is available.

`checkModelWithMultipleKeys` will forward the credential's empty key as `''`. It must not translate the provider-auth
credential to `undefined`, because that activates Main's normal key rotation instead of the historical keyless probe.

## Run immutability

A single-model run captures its model and key selection at Start. While `isStarting` or `isSingleModelChecking` is
true, the dialog disables:

- the model Combobox;
- the key-scope SegmentedControl; and
- the concrete API-key Combobox.

The mode control remains disabled under the existing rule. Cancel may still hide the dialog, preserving the accepted
branch behavior that a single-model request continues in the background. Provider changes and unmount remain the
cancellation boundaries already implemented by the branch.

This prevents an old success from closing a newly configured form and prevents an old all-key failure report from
appearing beneath a newly selected single-key scope.

## Preparation and error behavior

All-model Start has two preparation stages before background probes begin:

1. persist any pending API-key draft;
2. refetch the authoritative API-key entries.

A persistence failure keeps the existing API-key save feedback. A refetch failure or any other non-credential
preparation failure logs through `loggerService`, keeps the dialog open, resets loading state, and shows the existing
localized `failed_to_start` feedback. Missing required credentials retain the existing missing-key feedback.

No new retry system, error state machine, or Main-process recovery path is introduced.

## Dialog and result interaction

The new Dialog remains the unified entry surface, but its layout uses a bounded flex column:

- `DialogContent` stays within the viewport;
- header and footer remain visible;
- the form and single-model result area is the only scrollable region.

The top-level mode SegmentedControl receives a localized accessible name through its existing DOM props. When no
model is checkable, the model Combobox is disabled and receives localized placeholder and empty-state text explaining
that no model can be checked.

When any result API-key mutation is pending, every result Switch is disabled. The active Switch retains its loading
indicator; other switches remain visually stable but cannot start a competing mutation.

## Combobox integration boundary

Two separate Combobox concerns have different ownership:

1. The branch-added `aria-labelledby` API is responsible for preserving both the external field label and the current
   selected value in the default button trigger's accessible name. Its branch-added tests will verify that both are
   exposed.
2. Default content filtering by internal `value` predates this branch. The Model Check dialog will not change that
   shared behavior. Its new model and API-key consumers will use the existing `filterOption` prop to match visible
   label, value, and description.

This fixes the new integration without broadening the shared component contract beyond the API already added by the
branch.

## Public API boundary

`ModelListHealthProvider` and the combined `useModelListHealth` export already exist on `origin/main` and remain for
compatibility. The branch-added barrel exports for feature-internal run/results hooks will be removed because all
current consumers import them directly from the sibling context module.

No context redesign or public component extraction is included.

## Internationalization

Every Model Check key added by the branch must have runtime-ready values in all maintained locale files. Translation
files may not retain `[to be translated]` markers for this namespace. Existing translations that the branch replaced
with markers must be restored where available; new text follows the repository translation workflow.

## Testing

Tests assert user-visible contracts and request inputs rather than implementation-only calls.

### Credential tests

- login-based provider: Start is enabled without API-key entries and the probe uses provider authentication;
- `authOptional` with enabled keys: single and all selection produce explicit stable-key credentials;
- `authOptional` without enabled keys: the probe receives an explicit empty override and never implicit rotation;
- required-key provider without enabled keys: Start is blocked with missing-key feedback;
- single-model and all-model hooks use the same policy.

### Run and error tests

- a deferred single-model request disables model and all key controls until it settles;
- a run cannot close or populate a form configured after Start;
- API-key persistence failure retains its existing save feedback;
- API-key refetch failure keeps the dialog open and shows `failed_to_start`;
- all-model selection of a concrete key reaches Start as the matching stable key ID.

### UI contract tests

- long dialog content has a bounded scroll region with reachable footer actions;
- the top-level radiogroup has a localized accessible name;
- an unsupported-only provider exposes localized disabled/empty model selection;
- result switches use the real shared Switch and are disabled throughout a pending mutation;
- default Combobox triggers expose both field label and selected value;
- Model Check model and key searches match visible labels even when internal IDs differ.

### Cleanup checks

- no Model Check locale value contains `[to be translated]`;
- only the `origin/main`-compatible Model List barrel surface remains;
- focused Provider Settings and UI tests emit neither the branch-added React DOM warning nor new unhandled errors.

## Verification

Implementation proceeds test-first with the closest Vitest project for each task. After all focused tests pass, run
the repository-required commands in this order:

1. `pnpm lint`
2. `pnpm test`
3. `pnpm format`
4. `pnpm build:check`

If a formatting command changes files, rerun the affected focused tests and `pnpm build:check`. No Main-process test
expansion is required unless implementation unexpectedly changes a Main file, which this design explicitly avoids.
