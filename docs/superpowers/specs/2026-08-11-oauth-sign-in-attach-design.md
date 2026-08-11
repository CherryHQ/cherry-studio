# Atomic OAuth Sign-In Attach

## Goal

Restore a remounted Codex or Grok CLI login panel without racing the main-process OAuth flow, opening another browser authorization without a user action, or missing credentials that completed during restoration.

## Ownership and contract

`OAuthRuntimeService` remains the source of truth for active loopback sign-ins. Replace the renderer's `oauth.is_signing_in` check followed by `oauth.sign_in` with one `oauth.sign_in.attach` IpcApi request. The runtime operation synchronously captures the current `ActiveSignIn.promise` before its first `await` and never starts a flow.

The request returns one of these outcomes:

- `{ status: 'not-found' }` when no active flow existed at the instant of capture.
- `{ status: 'completed', account }` after the captured flow succeeds.
- The existing typed `SIGN_IN_CANCELLED` IPC error when the captured flow is cancelled.
- The existing normalized IPC failure for any other captured-flow error.

`oauth.sign_in` remains the user-initiated start operation, and `oauth.cancel_sign_in` remains the cancellation command.

## Renderer flow

On mount, the panel reads `oauth.has_token` first. If a token exists, it loads the account normally. Otherwise it shows the waiting controls while requesting `oauth.sign_in.attach`.

- `completed`: mirror provider enablement into renderer state and show the logged-in state.
- `SIGN_IN_CANCELLED`: return to idle without a failure toast.
- `not-found`: read `oauth.has_token` again. This second read covers a flow that persisted credentials and left the active map immediately before the attach attempt. If no token exists, return to idle.

Only a user click invokes `oauth.sign_in`; mount restoration never does.

## Alternatives rejected

1. Keep `oauth.is_signing_in` and add more renderer checks. Separate status and action requests cannot make capture atomic, so completion or cancellation can always occur between them.
2. Always call `oauth.sign_in` on mount. Its start-or-reuse semantics open a new browser flow when the previous flow has just settled.
3. Persist renderer-only login state. Renderer state is not authoritative for a main-owned callback server and can miss completion while the panel is unmounted.

## Cancellation boundary

This change does not expand cancellation into token exchange or persistence. The current Cancel operation is guaranteed for the pending browser-callback phase. The later-stage boundary is non-blocking review feedback and should be clarified separately rather than mixed into the atomic restoration fix.

## Tests

- Runtime: attaching captures an existing promise without acquiring a transport or opening a browser.
- Runtime: attach returns `not-found` when no active flow exists.
- Renderer: completion between the first token read and attach does not invoke `oauth.sign_in` and is recovered by the second token read.
- Renderer: cancellation between the first token read and attach returns to idle without a failure toast or a new sign-in.
- IPC handler: `OAuthSignInCancelledError` is mapped to `SIGN_IN_CANCELLED`.
- Existing cancel-and-immediate-retry behavior remains covered.

Verification is limited to the affected Vitest files plus the repository's required build check; the full test suite remains excluded per user instruction.
