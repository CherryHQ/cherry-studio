# Cherry Cloud

## Account and operation ownership

`CherryCloudService` owns the device-bound session and the terminal result of a
login operation. Concurrent login callers share that result; status events show
progress. Cancel, expiry and service stop settle pending callers. A browser-open
continuation cannot reject an already committed successful login.

Status and account receipts carry a `scopeId` derived from the existing lifecycle
and session generations, plus a locally ordered `revision`. A receipt records
account-read freshness and separate model/plan facts. Unknown facts carry no
value; stale facts retain their last successful value from the same scope.
These independent endpoint observations have no common server transaction version.

One `Sequencer` orders lightweight account/model synchronization and full
account/model/plan refreshes. Provider authorization keeps the lightweight path;
token refresh remains independent. Full refresh callers receive their own result,
and account changes or shutdown prevent old work from publishing. Notifications
commit refresh-dependent cursors and reset reconnect backoff only after the
corresponding full refresh succeeds in the same connection and account scope.

`CherryCloudService` also owns one in-flight Subscribe operation. Renderers send
one command; concurrent clicks across windows share its login and portal opening.
The first admitted request supplies the portal's source, flow and sender until
that operation settles. Sign-out releases it so a new account need not wait for
an old browser call; late completion cannot release the replacement operation.
Every click retains its own analytics event. Main checks
the managed sender and signed-in scope immediately before opening the trusted
account URL. Closing that sender prevents the portal without cancelling shared
authentication. A submitted browser action is not replayed after an uncertain
result. `subscriptionAnalytics.ts` formats the Cloud event envelope and identity;
generic analytics retains consent and transport.

The [ownership Spec](../../../../.agents/notes/proposed/architecture/2026-11-08-cherry-cloud-ownership-convergence.md)
records the preservation boundary, deliberate fixes and offline verification limits.

## Desktop region

Unified and bridge builds derive the effective region from an existing
account's trusted stored API origin. A signed request stays bound to that
session's origin. For an older session without an origin, the bridge records the
original package region alongside the session ID. The unified build can use a
matching record to continue the refresh after an upgrade. A successful refresh
writes the verified origin into the credentials. Profiles without an account reuse a persisted region or resolve one
through Config Service. Local inference is provisional until a successful
config response. New login authorizations use the confirmed origin for both
creation and exchange. Sign-out keeps the most recent account region for future
sign-ins.

## AMD entry

`openAmdEntry` signs in when required, then sends `POST` to the model's
`activation_endpoint` from the signed catalog (today `/api/v1/amd/desktop/entry`)
through `authenticatedFetch`, which refuses any other origin. If the refreshed
catalog shows the model authorized already, it opens nothing. The request has an
empty body and uses the v2 device signature, so every attempt gets a new request
ID. The response's `entry_url` is a 60-second, single-use credential that the
browser redeems. Main opens it unchanged, fragment included, only if it is on the
Cloud API origin. Never log, report or persist it. Concurrent clicks share one
in-flight entry.

Model sync requests `/v1/models?limit=1000&catalog=full`; without `catalog=full`
the server keeps the legacy entitled-only list for clients released before it.
AMD models arrive through `/v1/models` with `provider: "amd"` and need no plan.
Model sync treats an authorized one (`activation_required` not true) as an
entitled free model without a quota pool. A locked one never reaches the model
table: it goes into the receipt's `amdActivationRequiredModels`, and the selector
shows it as an "AMD 授权" row, named by `getAmdStatus` once signed in. A
`403 AMD_ACTIVATION_REQUIRED` or `AMD_CREDENTIAL_INVALID` response clears the
model sync cache and keeps the session, so the next sync locks the model again.

Signed out, model sync reads `/v1/models` with only the pre-login client HMAC,
the same scheme as the login requests; a refusal yields no catalog. Standalone
models with `requires_login: false` are usable then, and `modelFetch` sends their
requests with the HMAC over the exact body instead of a session. Signed in, every
standalone model is usable without a plan.

Each sync also reports `catalogModelIds`, every model the server lists. A stored
Cloud model missing from it has been delisted; the field is null when the
catalog could not be read, so a failed read never delists anything.

## Login request signing

The desktop client signs authorization creation and exchange requests using the
existing [Qwen/CherryAI signature implementation](../../ai/provider/cherryai.ts).
Cloud login uses a separate secret; PKCE, callback state validation, and the
post-login Ed25519 device signature remain unchanged.

### Build configuration

Set `MAIN_VITE_CHERRY_CLOUD_CLIENT_SECRET` in the trusted repository's Actions
secrets for release, nightly, preview, and signed Windows rebuilds. For local
development, configure the same variable in `.env` with a development-only secret
matching the local backend. It is a main-process build-time value, not a user
preference. Never commit a production value.

The value is used directly as the UTF-8 HMAC key: **do not append the legacy Qwen
secret suffix**. There is no fallback to `MAIN_VITE_CHERRYAI_CLIENT_SECRET`.
Without the cloud secret, login fails before sending an authorization request;
other providers and local features are unaffected.

### Wire contract

Signed endpoints:

- `POST /api/v1/desktop/authorizations`
- `POST /api/v1/desktop/authorizations/{authorization_id}/exchange`

Headers:

| Header | Value |
| --- | --- |
| `X-Client-ID` | `cherry-studio` |
| `X-Timestamp` | Unix time in whole seconds, decimal string |
| `X-Signature` | Lowercase hexadecimal HMAC-SHA256 |

The UTF-8 signature input is six fields joined with `\n`, with no trailing
newline: uppercase method, URL path, query string (empty for both endpoints),
client ID, timestamp, and the exact JSON body sent over the wire. Serialize the
body only once; server verification must use the received bytes, not parsed and
re-serialized JSON.

### Backend rollout

The cloud backend is maintained outside this repository. Client headers alone do
not restrict access; before enabling enforcement, the backend must:

1. Configure the matching cloud-only secret for `cherry-studio`.
2. Require and validate all three headers on both endpoints, reject malformed or
   expired timestamps within a bounded clock-skew policy, and compare the HMAC
   using a constant-time comparison.
3. Verify before creating an authorization or issuing a session. Preserve PKCE,
   handoff-code single-use enforcement, and device-key binding.
4. Coordinate enforcement with signed-client availability: old clients do not
   send these headers and will be rejected once enforcement is enabled.

This reuses the Qwen v1 protocol, which has no nonce and does not sign the origin.
A timestamp alone cannot prevent replay within its acceptance window; strict
replay protection requires server-side deduplication or a future protocol change.
Use different secrets for development and production. A distributed desktop
secret can be extracted, so this is a lightweight access hurdle, not proof of an
untampered official binary.
