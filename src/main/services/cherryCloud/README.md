# Cherry Cloud login request signing

The desktop client signs authorization creation and exchange requests using the
existing [Qwen/CherryAI signature implementation](../../ai/provider/cherryai.ts).
Cloud login uses a separate secret; PKCE, callback state validation, and the
post-login Ed25519 device signature remain unchanged.

## Build configuration

Set `MAIN_VITE_CHERRY_CLOUD_CLIENT_SECRET` in the trusted repository's Actions
secrets for release, nightly, preview, and signed Windows rebuilds. For local
development, configure the same variable in `.env` with a development-only secret
matching the local backend. It is a main-process build-time value, not a user
preference. Never commit a production value.

The value is used directly as the UTF-8 HMAC key: **do not append the legacy Qwen
secret suffix**. There is no fallback to `MAIN_VITE_CHERRYAI_CLIENT_SECRET`.
Without the cloud secret, login fails before sending an authorization request;
other providers and local features are unaffected.

## Wire contract

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

## Backend rollout

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
