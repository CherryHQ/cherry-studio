# OAuth Runtime

App-managed OAuth for **AI providers**. This is *not* the system-wide OAuth layer
— it is provider-scoped by design. Read the boundary section before extending it
or before wiring a new OAuth consumer through it.

## Scope & boundary

This runtime drives the PKCE authorization-code flow for providers whose
credential the app itself holds and refreshes: **Codex, Grok CLI, CherryIN**. It
owns the flow (authorize → callback → token exchange → persist → refresh) and
nothing else.

It is **provider-scoped**, not a general OAuth system. The one hard coupling is
storage: tokens persist into the *provider's* `authConfig` row in SQLite
(`ProviderAuthConfigOAuthTokenStore` → `providerService.update(providerId, …)`).
A non-provider entity (an MCP server, a cloud-sync account) cannot reuse this
runtime without its own `OAuthTokenStore` backend.

Other OAuth/auth flows in the app are deliberately **separate** and do not share
this code — they are different protocols or SDK-driven, and folding them in would
create a leaky mega-abstraction:

| Flow | Where | Why separate |
| --- | --- | --- |
| MCP remote servers | `src/main/ai/mcp/oauth/` | SDK-driven (`@modelcontextprotocol/sdk` `OAuthClientProvider`) + dynamic client registration (RFC 7591); control is inverted — the SDK drives, we implement an interface. Storage is per-server-URL JSON files. |
| GitHub Copilot | `src/main/services/CopilotService.ts` | Device flow (RFC 8628) — no redirect/callback; encrypted-file storage. |
| Nutstore | `src/main/services/nutstore/` | Proprietary SSO with custom encryption — not standard OAuth. |
| Feishu / WeChat | `src/main/ai/channels/adapters/` | Proprietary device/binary protocols — not OAuth. |
| Silicon / PPIO / 302 / AIHubMix / AIOnly | `src/renderer/utils/oauth.ts` | One-shot popup that returns an **API key** (no token session / refresh). |

**Do not** route any of the above through this runtime. If you think you need to,
re-read the table.

## Architecture

Three pieces, all keyed by `providerId`:

- **`OAuthRuntimeService`** — lifecycle service; the public surface
  (`signIn` / `startDeepLinkFlow` / `getValidAccessToken` / `logout` /
  `hasToken` / `getAccount`). Entity-agnostic except for the injected token store.
- **Transports** — how the authorization code comes back:
  - `LoopbackCallbackTransport` — spins a localhost HTTP server (Codex, Grok).
  - `DeepLinkCallbackTransport` — waits for a `cherrystudio://` deep link, then
    pushes the result point-to-point to the initiator window via
    `IpcApiService.send('cherryin.oauth_result', …)` (CherryIN). The OAuth token
    never crosses to the renderer — only the side-effect API keys do.
- **`providers/<id>.ts`** — one file per login provider: its client/urls/scope/
  transport plus optional behavior hooks. **`providerDefinitions.ts`** is the
  registry that wires each definition onto its provider id.

Token storage sits behind the `OAuthTokenStore` interface
(`OAuthTokenStore.ts`). Today only `ProviderAuthConfigOAuthTokenStore` exists.
That interface is the seam that would let a non-provider consumer plug in a
different backend — see "Extending" below.

## Adding a provider

Adding the **OAuth flow** is one file in `providers/<id>.ts`, registered in
`providerDefinitions.ts`. The variation points are covered by the definition's
fields and hooks:

- declarative: `clientId`, `transport` (loopback ports / deep-link redirect),
  client urls, `scope`, `clearDisablesProvider`, `extraAuthParams`.
- `createClient(context)` — build the `PkceOAuthClient`. Async when the provider
  needs OIDC discovery first (Grok). Host-pin discovered endpoints.
- `extractAccountId(accessToken)` — pull an account id out of the token (Codex's
  JWT claim). Omit if the provider has no account concept.
- `afterPersistTokens(tokenData, context)` — post-exchange side effect, run
  *after* the tokens are persisted so a failure here never discards a valid token
  (CherryIN fetches the user's API keys here). Omit for vanilla providers.

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
   deep-link providers currently need a bespoke panel (`CherryInOauth.tsx`).
4. **i18n** — `settings.provider.<ns>.*` keys (`pnpm i18n:sync`).
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
