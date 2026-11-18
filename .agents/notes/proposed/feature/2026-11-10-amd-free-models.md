# Agent Note: AMD free models through Cherry Cloud

Status: proposed

English | [中文](2026-11-10-amd-free-models.zh.md)

## Problem

Cherry Studio and the AMD AI Developer Program agreed to offer AMD-hosted models free of charge to China-edition users. AMD requires each user to own an AMD developer account; usage is metered per user through that account's own Token Factory API key, and AMD identifies Cherry-sourced accounts by `register_source=cherry-studio`.

AMD's partner registration API (ADP v0.1, 2026-10-27) only accepts requests that carry an AMD-issued `client_id`, are signed with a partner RSA private key (SHA256withRSA), and originate from a registered egress IP. It therefore cannot be called from the desktop client or a browser. AMD's load (`GET /v1/models/utilization`) and usage endpoints also require the user's own key.

Today nothing connects these pieces: the desktop client can only reach AMD through the user-configured `radeon-cloud` provider, the Cherry Cloud gateway holds one global key per upstream provider, and there is no partner registration flow. A local prototype (registration web page with three steps, a status page, and a selector group with locked "AMD 授权" rows) was reviewed with the product owner on 2026-11-10 and fixes the user-facing shape this Spec targets.

## Proposal

The feature spans three deliverables. Each keeps one owner for its state.

### Cherry Cloud API (`cherry-studio-cloud-api`, China region only)

- **AMD partner client.** A small package signs every partner request with `X-ADP-Client-Id`, `X-Timestamp`, `X-Nonce` and `X-Signature` over `X-App-Id={client_id}&X-Timestamp={ts}&X-Nonce={nonce}&Body={raw_body}`, reusing the RSA key parsing in `internal/alipay/sign.go`. It exposes Form, Companies, SendPhoneCode and Register, plus usage and utilization calls made with a user key. Configuration uses `CLOUD_API_AMD_*` variables delivered through the existing Secret/SealedSecret mechanism; the feature stays off unless every value is present. Outbound calls use the region's dependency timeout and never retry a Register whose outcome is unknown.
- **Registration state.** A China-only table records, per Cherry account, the AMD `user_id`, the AMD API key sealed with an account-bound associated value, `register_source`, status, and the in-flight attempt (idempotency key, request hash, `possibly_sent`), following the `alipay_customer` pattern. Raw keys never appear in logs, responses or analytics.
- **Web endpoints** (web session plus CSRF, same rules as `/api/v1/web-account`): registration form (with the account's verified phone fetched from ZITADEL for prefill and never stored), company search, phone code, register, registration status, and model load. AMD's response envelope (`code`, `field_errors`, `retry_after`) is relayed unchanged so the page can place each error on its field.
- **Model catalog.** AMD models are not a plan. The server lists the models configured in `CLOUD_API_AMD_MODELS` (IDs prefixed `amd/`, `openai-chat-completions` only) in every China-region account's `/v1/models`, marked `provider: "amd"` and `activation_required` until the account has a usable AMD key. `GET /api/v1/public/plans` lists the same models in `amd_models`, so signed-out clients can show them. AMD requests take no Cherry quota reservation, deduction or settlement.
- **Gateway.** A request for an `amd/` model is proxied to the environment's AMD model gateway with the caller's sealed AMD key, never a provider or another account's key, and never falls back to a paid model. A missing or revoked binding returns `403 AMD_ACTIVATION_REQUIRED`; a key AMD rejects returns `403 AMD_CREDENTIAL_INVALID` and is not a sign-out signal; AMD's own `429` returns `RATE_LIMITED` with `Retry-After` kept.
- **Desktop-to-web handoff.** `POST /api/v1/amd/desktop/entry` (Product Session bearer, v2 device signature over the empty body, fresh request ID per call) returns `{ entry_url, expires_in }`: an `https://<cloud-api-origin>/amd/enter#<credential>` link valid for 60 seconds and redeemable once. The browser redeems it, sets the web session cookie and redirects; the page then requires the same Cherry account as the desktop. This proves the visit started in the client without CORS or shared cookies.

### Registration web page (new standalone frontend project)

- Two pages. **Activate**: title, one sentence, the model chips, a three-step form (basic info → developer profile → phone verification) and a one-line notice; required fields marked `*`; empty fields disable the step button and only wrong input shows an error. **Model status**: per-model load from AMD utilization (`idle`/`busy`/`full`/`unknown`, percentage, 10-second refresh), shown only to registered users.
- It talks only to the Cherry Cloud web endpoints above; it never holds AMD credentials.
- The local prototype under `.context/amd-register-web/` (in this workspace) is the visual reference; the project, hosting origin and deployment are created as part of this work.

### Desktop client (`cherry-studio`)

- The CherryAI selector group shows the server's catalog to every user; the client keeps no model list of its own. Each locked row names what unlocks it:
  - **Free models**: signed out, the free plans of `/api/v1/public/plans` appear as locked rows; clicking signs in to Cherry AI.
  - **Subscription models**: the paid plan previews, as today; clicking starts a subscription.
  - **AMD models**: `amd_models` while signed out, and the `activation_required` entries of `/v1/models` once signed in, appear as locked "AMD 授权" rows whose hover explains AMD authorization. Clicking signs in first when needed; then Main requests the entry link and opens it unchanged in the system browser. The client never builds the page URL and never logs, reports or stores the link.
- Authorized AMD models sync into the CherryAI provider like entitled models, tagged free and without quota. Locked AMD models stay out of the model table.
- A chat request refused with `AMD_ACTIVATION_REQUIRED` or `AMD_CREDENTIAL_INVALID` invalidates the model snapshot, so the next sync shows the model as locked; the composer then offers "AMD 授权" instead of sending. The Cherry session is kept.
- The client does not read `GET /api/v1/amd/desktop/status`. The row copy names AMD authorization without promising a new registration, so it stays correct while registration is closed, and the web page owns the register, link and wait branches.
- The built-in Qwen model requires a signed-in Cherry AI account: Main refuses its requests while signed out, and the composer shows the existing sign-in notice. It is retired once the server's free plan carries an equivalent model.
- After the user returns, the existing focus refresh re-syncs plans and models; no polling is added.
- Whether AMD is offered at all is the server's decision: the global region returns no AMD models. Selectors that hide subscription offers show no locked rows of any kind.

### Scope limits

- Global edition: excluded until AMD completes its compliance review.
- Linking an existing AMD account happens on the web page; the client only opens the entry.
- In-app load display: excluded; load is shown on the web status page only.

## Alternatives considered

- **In-app registration dialog.** Built and reviewed, then rejected by the product owner on 2026-11-10: registration must happen on a web page, and the dialog duplicated form and legal UI in the client.
- **Client calls AMD directly with the user's key.** Rejected: AMD requires a partner-signed, IP-whitelisted registration, and keeping keys server-side preserves Cherry's request accounting, risk control and revocation.
- **One shared AMD partner key for all users.** Rejected: AMD meters and grants quota per user key and identifies Cherry-sourced users by key; a shared key loses both.
- **Hosting the page inside `web-account` on the API origin.** Simpler authentication, but the owner chose a standalone project; the entry link keeps that choice independent of origin.
- **A partner plan granted on registration.** Superseded: AMD models need the caller's own key rather than a quota pool, so the server lists them from `CLOUD_API_AMD_MODELS` with `activation_required` instead of granting a plan.
- **Client-side placeholder list of AMD models.** Removed: it drifted from what the gateway could serve, and a server catalog lets AMD models change without a client release.

## Acceptance criteria

- AC1 — The Cloud API AMD client produces the exact signature for AMD's documented example and rejects unsigned, expired or misconfigured calls before sending. (verification: unit; owner: Cloud API)
- AC2 — Against a fake AMD server, form, company search, phone code and register relay AMD's envelope and field errors unchanged; a repeated register with the same body reuses its idempotency key, a changed body gets a new key, and an attempt with unknown outcome is never resent automatically. (verification: integration; owner: Cloud API)
- AC3 — A successful registration or link stores the sealed AMD key; the account's `/v1/models` then lists the AMD models with `activation_required: false`, `/api/v1/public/plans` lists them in `amd_models`, and no response or log contains the raw key or full phone number. (verification: integration; owner: Cloud API)
- AC4 — A chat request for an AMD model is proxied with the caller's own AMD key; a caller without a usable binding receives `403 AMD_ACTIVATION_REQUIRED`, a rejected key `403 AMD_CREDENTIAL_INVALID`, and AMD `429` surfaces as `RATE_LIMITED`. (verification: integration; owner: Cloud API)
- AC5 — The model-load endpoint returns AMD utilization per model for registered accounts, preserves `unknown`, and refuses unregistered accounts. (verification: unit and integration; owner: Cloud API)
- AC6 — An entry link from `/api/v1/amd/desktop/entry` opens the web page as the same Cherry account, expires after one use or 60 seconds, and cannot be replayed; the desktop requests it with a signed empty-body POST and opens the returned URL unchanged, refusing one outside the Cloud API origin. (verification: integration and main tests; owner: Cloud API and desktop)
- AC7 — The web page completes the three-step registration and shows the status page against the Cloud API endpoints, places relayed field errors on their steps, and never shows required-field errors for untouched empty fields. (verification: web unit tests and manual run against a test deployment; owner: web project)
- AC8 — The CherryAI selector group lists the server catalog: signed out, free, subscription and AMD rows each locked with their own unlock (sign in, subscribe, AMD authorization); signed in, unauthorized AMD models as locked "AMD 授权" rows and authorized ones as selectable free models after focus refresh; no client-side model list, and no locked rows in offer-free selectors. An AMD refusal locks the model without signing out, and the composer offers AMD authorization. Signed out, Qwen cannot be sent and the composer asks the user to sign in. (verification: renderer and main tests, Electron; owner: desktop)
- AC9 — With any `CLOUD_API_AMD_*` value missing, or in the global region, the AMD routes, catalog entries and gateway branch are inactive and existing behavior is unchanged. (verification: unit config tests; owner: Cloud API)

## Risks

- **Pending AMD changes.** The v0.1 register API still requires a password and does not return the API key; AMD committed to make password optional and return `APIKey`, and to add a login-and-get-key API for existing accounts. AC3 and AC4 cannot pass against AMD until those ship; the fake server encodes the committed contract.
- **Credentials and network.** `client_id`, the private key and the egress-IP registration are not yet issued; the test environment needs them too. Live verification waits on them.
- **Copy and terms.** `terms_version` is "to be confirmed"; benefit wording (new-user quota, dedicated resources, first model batch) must be confirmed with AMD before release.
- **Phone source.** Prefill depends on ZITADEL holding a verified phone; accounts without one type their number and receive AMD's own SMS code.
- **Key revocation.** If a user rotates the key in AMD's console, the next request returns `AMD_CREDENTIAL_INVALID`; the model locks again and the user re-authorizes through the same entry.
- **Cross-repository delivery.** Three deliverables ship separately. The desktop shows AMD rows only when the server lists AMD models; signed-out users see them only once `/api/v1/public/plans` carries `amd_models`, and a general picker offers them only when their `available_features` include both `chat` and `translate`.
