# OAuth Runtime

App-managed OAuth for **AI providers**. This is *not* the system-wide OAuth layer
— it is provider-scoped by design. Read the boundary section before extending it
or before wiring a new OAuth consumer through it.

## Scope & boundary

This runtime drives the PKCE authorization-code flow for providers whose
credential the app itself holds and refreshes: **Codex, Grok CLI, CherryIN** and
**Vertex AI "Sign in with Google"**. It
owns the flow (authorize → callback → token exchange → persist → refresh) plus
the provider's enablement: a successful sign-in flips the provider `isEnabled`
on, and logout flips it off (and resets `authConfig` to `api-key`). Vertex
logout only drops its session and leaves the provider configured and enabled.

It is **provider-scoped**, not a general OAuth system. The hard coupling is to
the *provider* row in SQLite: tokens persist into that row's `authConfig`
(`ProviderAuthConfigOAuthTokenStore` → `providerService.update(providerId, …)`),
and the same `providerService.update` toggles `isEnabled` on sign-in/logout. A
non-provider entity (an MCP server, a cloud-sync account) cannot reuse this
runtime without its own `OAuthTokenStore` backend and its own enablement model.

Other OAuth/auth flows in the app are deliberately **separate** and do not share
this code — they are different protocols or SDK-driven, and folding them in would
create a leaky mega-abstraction:

| Flow | Where | Why separate |
| --- | --- | --- |
| MCP remote servers | `src/main/ai/mcp/oauth/` | SDK-driven (`@modelcontextprotocol/client` `OAuthClientProvider`) + dynamic client registration (RFC 7591); control is inverted — the SDK drives, we implement an interface. Storage is per-server-URL JSON files. |
| GitHub Copilot | `src/main/services/CopilotService.ts` | Device flow (RFC 8628) — no redirect/callback; encrypted-file storage. |
| Nutstore | `src/main/services/nutstore/` | Proprietary SSO with custom encryption — not standard OAuth. |
| Feishu / WeChat | `src/main/ai/channels/adapters/` | Proprietary device/binary protocols — not OAuth. |
| Silicon / PPIO / 302 / AIHubMix / AIOnly | `src/renderer/utils/oauth.ts` | One-shot popup that returns an **API key** (no token session / refresh). |

**Do not** route any of the above through this runtime. If you think you need to,
re-read the table.

## Architecture

Three pieces, all keyed by `providerId`:

- **`OAuthRuntimeService`** — lifecycle service; the public surface
  (`signIn` / `joinActiveSignIn` / `cancelSignIn` /
  `getValidAccessToken` / `logout` / `hasToken` / `getAccount`). Entity-agnostic except for the token store, which
  it constructs internally today (`new ProviderAuthConfigOAuthTokenStore()`);
  a definition may supply its own `tokenStore` instead (Vertex). It finds a
  provider's definition only through `resolveOAuthProviderDefinition`.
- **`LoopbackCallbackTransport`** — receives authorization codes through a
  localhost HTTP server for Codex, Grok, CherryIN and Vertex.
- **`providers/<id>.ts`** — one file per login provider: its client/urls/scope/
  transport plus optional behavior hooks. **`providerDefinitions.ts`** is the
  registry that wires each definition onto its provider id, plus
  `resolveOAuthProviderDefinition(providerId)`, which applies the registry and
  the Vertex rule below.

Token storage sits behind the `OAuthTokenStore` interface
(`OAuthTokenStore.ts`). `ProviderAuthConfigOAuthTokenStore` replaces the
provider's authConfig with an `oauth` one. `VertexGoogleOAuthTokenStore` keeps
the session inside Vertex's `iam-gcp` authConfig, because project, location and
the organisation's OAuth client live there and must survive sign-in and logout.
The runtime passes each store the client id of the `PkceOAuthClient` that minted
the tokens; the Vertex store refuses tokens from a client other than the saved one
(the client was changed during sign-in), since they could never refresh.

## Adding a provider

Adding the **OAuth flow** is one file in `providers/<id>.ts`, registered in
`providerDefinitions.ts`. The variation points are covered by the definition's
fields and hooks:

- declarative: `transport` (loopback hosts, port, path and redirect URI),
  client urls, `scope`, `clearDisablesProvider`, `extraAuthParams`, `tokenStore`.
- `createClient(context)` — build the `PkceOAuthClient`. Async when the provider
  needs OIDC discovery first (Grok). Host-pin discovered endpoints.
- `extractAccountId(accessToken, tokenData)` — pull an account id out of the
  token response (Codex's JWT claim, Vertex's id_token email). Omit if the
  provider has no account concept.
- `revokeToken(refreshToken)` — best-effort revocation on logout (Vertex).
- `afterPersistTokens(tokenData, context)` — post-exchange side effect, run
  *after* the tokens are persisted so a failure here never discards a valid token
  (CherryIN fetches the user's API keys here). Omit for vanilla providers.

Vertex AI is the exception to one-definition-per-id: the built-in `vertexai` is
registered, and `resolveOAuthProviderDefinition` gives any available user-created
provider with an `iam-gcp` authConfig its own `createVertexGoogleOAuthProvider(providerId)`
definition (cached per id). Its OAuth client is read from the provider's saved
credentials, not fixed in the definition.

But a provider is more than its OAuth flow. End-to-end, a new login-based
provider also touches:

1. **Identity** — `src/shared/data/presets/<provider>.ts` (id + `is…ProviderId`).
2. **Auth-kind flag** — tag the provider's `authMethods` in the shipped registry
   (`packages/provider-registry/data/providers.json`); login-based UI gating
   (`isLoginBasedProvider`, the generic api-key panel suppression) derives from
   it — `['oauth']` / `['external-cli']` are login-based, anything including
   `'api-key'` is not.
3. **Settings UI** — an entry in `providerSpecificSettingsRegistry.tsx`. Loopback
   providers reuse the shared `LoginOauthPanel` (pass `i18nNs`, `showAccountId`);
   CherryIN retains its bespoke panel for API keys and balance.
4. **i18n** — `settings.provider.<ns>.*` keys; complete every locale and validation step in the [i18n workflow](../../../../../docs/dev/references/i18n/README.md#translation-completion-in-pull-requests).
5. **Chat runtime** — `src/main/ai/provider/config.ts` (`buildXxxConfig` /
   `buildXxxFetch`) + per-provider request shaping. This is a *separate axis*
   from OAuth (every upstream API differs) and cannot be made config-only.
6. **Model catalog** — the registry row + `provider-models.json`
   (`modelListSource: 'registry'` for subscription providers).

## Extending

The runtime's seams are already the right shape for two future moves; neither is
worth doing until a real second consumer appears (YAGNI):

- **Config over code.** Most of each `providers/<id>.ts` definition is data; the
  inline functions reduce to a few declarative fields plus a generic core:
  `extractAccountId` → `accountIdClaim: { jwtPath, field }`; Grok discovery →
  `discovery: { url, allowedHostSuffix }`; the nonce → a `requiresNonce` flag.
  After that a vanilla loopback PKCE provider is a pure-data entry with zero
  OAuth code; only exotic behavior (CherryIN's side effect) stays a hook.

- **General OAuth (don't, yet).** The flow engine (transports + `PkceOAuthClient`
  + orchestration) is entity-agnostic; only the token store is provider-tied.
  Making it system-wide means: generalize `providerId` → a subject id, inject the
  `OAuthTokenStore` per subject, decouple the panels from `useProvider`, and add
  a `device-code` transport for Copilot. Do this only when a second *self-driven*
  (non-SDK) OAuth consumer needs the shared refresh/expiry/secure-storage path.
  MCP is not that consumer — it is SDK-driven and rightly owns its own flow.

## CherryIN HTTP callback

CherryIN uses `http://127.0.0.1:29873/oauth/callback`. Register this exact URI in
Hydra before releasing the client. The listener must bind before the browser opens.
`cherryin.sign_in` returns provisioned API keys only to the initiating window after
token storage; access and refresh tokens remain in the main process. Other
windows may observe completion through `oauth.sign_in.attach`, which returns only
the account id. Cancellation requires a request registered by the calling window.
API-key retrieval has a 30-second timeout; failure retains the stored OAuth tokens
and releases the login so the user can retry.
