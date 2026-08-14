# Model Check Key Toggle Retention Design

## Context

Model Check results expose an enablement switch for every participating API key. Turning a key off updates its
`isEnabled` state, which also changes the authentication section's derived `inputApiKey` string because that string
contains only enabled keys. Both model-check hooks currently treat every `inputApiKey` change as credential editing,
abort the active run, and clear its report.

This conflicts with the accepted result-management behavior: enablement changes made from a report must preserve the
current run, while the next run must exclude disabled keys.

## Approved behavior

- A model-check run uses the credential snapshot captured when it starts.
- Disabling or re-enabling a key does not abort an active run or clear a completed report.
- Result cards immediately reflect the key's current enabled or disabled state after the mutation succeeds.
- A later run resolves credentials again and excludes keys that are disabled at that time.
- A real credential edit, provider change, endpoint change, or unmount still cancels the old run and prevents stale
  results from updating the page.

## Existing repository practices

- `useProviderApiKey` already distinguishes a user-authored draft from synchronized server state through
  `hasPendingSync`.
- Model-check credential fingerprints include key identity, value, and label but intentionally exclude `isEnabled`, so
  a persisted enablement-only update does not invalidate a report.
- Provider and endpoint changes already have explicit cancellation effects in both model-check hooks.

These existing boundaries allow the fix to stay in the feature hooks without changing DataApi, IPC, or shared types.

## Design

Both `useHealthCheck` and `useProviderConnectionCheck` will consume `hasPendingSync` from
`useAuthenticationApiKey`.

The broad reset effect will stop depending on raw `inputApiKey`. It will continue to reset for provider and endpoint
changes. A separate draft-edit effect will watch both `inputApiKey` and `hasPendingSync`, but abort and clear only
while `hasPendingSync` is true. This still catches subsequent edits while a draft remains pending without treating a
server-synchronized enablement change as a credential edit.

Persisted credential changes remain covered by the existing credential fingerprint effect:

- key value, identity, label, addition, or deletion changes invalidate the old report;
- enablement-only changes do not alter the fingerprint and therefore retain the current report.

No suppression flag or timing-dependent exception will be added around the API-key mutation.

## State flow

### Enablement change from a result

1. The result switch patches the selected key's `isEnabled` state.
2. Provider API-key data refreshes.
3. `useProviderApiKey` synchronizes its enabled-key string with `hasPendingSync` remaining false.
4. The model-check run is not aborted and its result collection remains mounted.
5. The controlled switch reflects the refreshed `isEnabled` value.
6. The next run resolves only the keys that are enabled at that time.

### Credential content edit

1. The user edits the authentication key input.
2. `useProviderApiKey` marks the draft with `hasPendingSync=true`.
3. Both model-check hooks abort their active run and clear stale results.
4. Saving and refetching the new credential content establishes the next run's fingerprint.

## Error behavior

API-key mutation failures keep the existing controlled switch state, retain the current report, log through
`loggerService`, and show the existing localized save-failure toast. This change does not alter mutation rollback or
probe error presentation.

## Testing

Add regression coverage to both model-check hook suites:

- start an in-flight run, update `isEnabled` and the derived `inputApiKey` while `hasPendingSync=false`, and assert that
  the signal is not aborted and results are retained;
- toggle a key after a completed run and assert that the report remains;
- change the authentication draft with `hasPendingSync=true`, including a subsequent edit while it remains true, and
  assert that the active run is aborted and results are cleared;
- retain the existing provider, endpoint, credential-content, and unmount cancellation assertions.

Run the focused Provider Settings tests first, then the repository-required `pnpm lint`, `pnpm test`, `pnpm format`,
and `pnpm build:check` before completion.

## Non-goals

- Selectively cancelling only one key's already-started probes.
- Adding main-process IPC cancellation.
- Changing the result-card layout or switch presentation.
- Rechecking a key automatically when it is re-enabled.
