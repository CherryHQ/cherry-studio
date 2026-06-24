# Design: Login-Based Providers — Capability Model & Migration

Status: final skeleton · Scope: PRs #16283 (claude-code), #16325 (openai-codex), #16327 (grok-cli)

This doc resolves the architectural concern raised by 0xfullex on #16283: a provider *kind* was encoded as the literal identity `claude-code` and branched on across ~10 layers, with one bespoke seeder per provider. It records the agreed model after a three-way review (V + Claude + Codex).

## 1. Roadmap answer (the question 0xfullex asked)

> "Are more subscription-login / API-less providers on the roadmap? A clear 'no' resolves this."

**Yes.** openai-codex (#16325) and grok-cli (#16327) are written and stacked on top of #16283, and both are **chat-capable**. So the per-instance approach does not scale — generalize. The two stacked PRs are themselves the duplication 0xfullex predicted (two near-identical OAuth services, three near-identical seeders).

## 2. Prior art — we are extending, not inventing

Login-based providers already exist in the codebase. New ones must reuse this machinery:

| Provider | Login | Creds stored | Lists models over API | Chat | Runtime |
|---|---|---|---|---|---|
| **CherryIN** | OAuth PKCE (deep-link callback) | `authConfig` (`type:'oauth'`) | ✅ API | ✅ | normal |
| **GitHub Copilot** | OAuth device flow | encrypted file (`safeStorage`) | ✅ API | ✅ | normal |
| openai-**codex** | OAuth PKCE (loopback callback) | `authConfig` | ❌ registry | ✅ | normal |
| grok-**cli** | OAuth OIDC+PKCE (loopback callback) | `authConfig` | ❌ registry | ✅ | normal |
| **claude-code** | external CLI | **not stored** (read-only probe) | ❌ registry | ❌ | **claude-agent-sdk only** |

Key consequences:
- `CherryInOauthService` (`src/main/services/CherryInOauthService.ts`) already does PKCE, authorize-URL, code exchange, **token refresh**, persist-to-`authConfig`, session cleanup. **`CodexOauthService` and `GrokCliOauthService` are reinventing it.**
- The only real delta vs CherryIN is the **callback transport**: CherryIN uses a deep-link (`cherrystudio://oauth/callback` via `ProtocolService`); codex/grok must use a **loopback HTTP server** because OpenAI/xAI register fixed `http://localhost:PORT` redirect URIs. Everything else is shared.
- Login-based ≠ special. CherryIN, Copilot, codex, grok are all normal chat providers. **Only `claude-code` is the exception**, and its exceptionality has nothing to do with OAuth — it is about how its credential is used.

## 3. The two orthogonal capabilities (the whole model)

The mistake in the first draft was a `usableInChat` boolean and a per-provider `runtimeProfile`. The correct decomposition is **two independent properties**, defaulting so that **existing providers are untouched**:

### 3.1 `modelListSource: 'api' | 'registry'` (default `'api'`)

Whether the provider's model list comes from its API or from the shipped registry.
- `'registry'` → **codex, grok, claude-code** (catalog ships in the registry; cannot pull over API).
- Everything else (CherryIN, Copilot, OpenAI, …) → default `'api'`, unchanged.

Drives **one** thing: the model-list chokepoint in main, `AiService.listModels` (`src/main/ai/AiService.ts:696`). For a `registry` provider it returns `providerRegistryService.listProviderRegistryModels({ providerId })` instead of calling the provider API; everything downstream (enrich via `:resolve`, reconcile, enable-on-models-available) is the **existing, unchanged** pull flow.

The UI is untouched: the "Pull / list models" button works for every provider; a `registry` provider just receives a fixed list. **No seeder, no `:resolve` display special-case, no hidden button** — see §7. Consequence (intended): a `registry` provider starts with no models and disabled, exactly like any API provider, until the user pulls and enables — no boot-time auto-materialization.

### 3.2 `credentialSource: 'external-cli' | …` (absent = normal)

Marks a provider whose credential is **not an app-held token** — it lives in an external CLI's store and only works through that CLI's runtime.
- Set on **claude-code only**.
- Everything else → absent, unchanged.

Drives: (a) runtime env strip, (b) exclusion from chat/@-mention pickers, (c) the fact that no credential is persisted (read-only login probe instead).

> This is NOT `authConfig.type`. `authConfig` is persisted runtime token state; claude-code stores no token, so it has no `authConfig` at all. `credentialSource` is a registry capability, not a stored credential.

### 3.3 What we deliberately do NOT add

| Rejected | Why |
|---|---|
| `usableInChat` boolean | chat-exclusion derives from `credentialSource`; a boolean implies a false chat/agent axis |
| `runtimeProfile` / `usableIn[]` / `agentRuntimes[]` on every provider | would touch every existing provider; agent compatibility is derivable (3.4) |
| `authConfig.type: 'oauth-cli'` | claude-code stores no token; two sources of auth truth |
| greenfield `LoginOauthService` | `CherryInOauthService` already is it (§5) |

### 3.4 Agent-runtime compatibility — derived, no new field

Keep today's mechanism: agent pickers match on **wire format / endpoint** (`NATIVE_ANTHROPIC_PROVIDER_IDS` keys off `ENDPOINT_TYPE.ANTHROPIC_MESSAGES` in `useAgentModelFilter.ts`).
- `claude-agent-sdk` runtime accepts `anthropic-messages` → includes claude-code.
- A future OpenAI-Responses agent runtime will accept `openai-responses` → **auto-includes codex/grok, auto-excludes claude-code** (wrong wire) — with **no per-provider change**, exactly the desired behavior.

## 4. Flag propagation — main-process read-layer join (decision: option C)

Registry capability flags are **shipped facts, not user settings**, so they are NOT persisted into `userProvider`. They are merged onto the `Provider` object in the main-process read layer (`ProviderService`), so every renderer consumer stays **synchronous** (no new async query, no `userProvider` migration/override semantics).

```ts
// ProviderService — when returning Provider objects
return rows.map((p) => ({
  ...p,
  modelListSource: registry.get(p.presetProviderId)?.modelListSource ?? 'api',
  credentialSource: registry.get(p.presetProviderId)?.credentialSource,  // undefined = normal
}))
```

Consumers read these fields off the already-loaded provider, replacing the `isClaudeCodeProviderId` / `isAgentOnlyProviderId` calls:
- `modelListSource` — read in **main** by `AiService.listModels` (via `getByProviderId`, which carries the joined flag).
- `credentialSource` — read in **renderer** (`useModelSelectorData`, `useMentionModelsPanel` for chat exclusion) and in **main** (`settingsBuilder` env strip).

Rejected: (A) persist into `userProviderTable` — pollutes user data with shipped facts, needs migration/sync; (B) separate registry-metadata DataApi query — turns sync predicates into async joins at every consumer.

## 5. OAuth service — generalize `CherryInOauthService`, don't build new

codex/grok must NOT ship two new bespoke services. Generalize the existing one:

- Extract the shared core (PKCE gen, authorize URL, code exchange, refresh-on-expiry, persist to `authConfig`, cleanup) — already present in `CherryInOauthService`.
- Parameterize **two callback transports**: existing **deep-link** (CherryIN) and new **loopback HTTP server** bound to `127.0.0.1:PORT` (codex/grok).
- Per-provider differences become small config, not whole classes:
  - codex: fixed endpoints, port 1455, `accountId` extraction from token response.
  - grok: OIDC discovery + `*.x.ai` host allowlist (this validator stays **code**, it's a security boundary), port 56121.
- Reuse the existing `authConfig` `type:'oauth'` variant; the only schema add is `accountId?` (already in the codex PR).
- **claude-code does not use this service** — it is CLI-delegated; its read-only login probe (`CodeCliService.checkClaudeLogin`) and terminal launch stay as-is.

Minimal `login` config the two self-managed consumers differ on (nothing speculative):

```ts
login: {
  clientId: string
  redirectPort: number
  scopes?: string[]
  endpoints: { authorizeUrl: string; tokenUrl: string }
             | { oidcDiscoveryUrl: string; allowedHosts: string[] }
  accountId?: { source: 'token-response-field'; field: string }   // codex only
}
```

## 6. Request shaping — a chokepoint strategy map, not data

Body/header shaping is **irreducible code** (3 distinct wire variants; even codex & grok, both `openai-responses`, shape differently — so `wireFormat` is too coarse to eliminate it). Centralize instead of scattering `if (p.id === …)`:

```ts
// src/main/ai/provider/loginShapers.ts
export const REQUEST_SHAPERS: Record<string, ProviderRequestShaper> = {
  [OPENAI_CODEX_PROVIDER_ID]: { /* store:false + encrypted reasoning, account header */ },
  [GROK_CLI_PROVIDER_ID]:     { /* hoist system→instructions, drop reasoning, x-grok headers */ },
}
```

`config.ts` gets ONE builder: `match: (p) => REQUEST_SHAPERS[p.id] != null`, builds the OpenAI-Responses config with a custom `fetch` that pulls the token from the generic OAuth service and applies the shaper. New provider = one map entry, no new builder. (This is an identity-keyed map at a single chokepoint — acceptable; it is not sold as "data-driven".)

## 7. No seeder — the list chokepoint replaces it

The earlier draft proposed a generic catalog seeder. **Dropped.** Seeding is the wrong mechanism: it pre-materializes models into `user_model` at boot, auto-enables the provider, and needs side-effect-as-state detection (`didFirstMaterialization`) plus user-disable preservation — the exact fragility 0xfullex flagged (it already needed one follow-up fix).

Instead, `registry` providers flow through the **normal pull path**, sourced from the registry at the §3.1 chokepoint:
- **Delete** `ClaudeCodeProviderSeeder` (and never add codex/grok seeders); remove it from `seeding/index.ts`.
- **Delete** the claude-code display special-case: `readsRegistryModels` + the `:resolve`-as-list query in `useProviderModelList.ts`, and the hidden-Pull branch in `ModelList.tsx`. (The `:resolve` endpoint stays — it is still used by `modelSync.ts` to *enrich* fetched models with registry metadata.)
- Net: ~3 deleted files/branches, zero added. A `registry` provider gets its models the same way every provider does — the user pulls; main returns the fixed list; reconcile materializes the selected rows and enables the provider via the existing `enableProviderWhenModelsAvailable`.

## 8. Phasing (maps to the stack)

**Phase 1 — #16283 (claude-code).** Lands what claude-code actually consumes; nothing OAuth-related (no consumer yet).
- Add `modelListSource` + `credentialSource` to the registry provider schema; propagate via §4.
- **Delete** `ClaudeCodeProviderSeeder` and route `AiService.listModels` to the registry for `modelListSource === 'registry'` (§3.1/§7); delete the claude-code `readsRegistryModels` / hidden-Pull display special-case.
- Replace `isClaudeCodeProviderId` / `isAgentOnlyProviderId` call sites with capability reads: env strip + chat/@-mention exclusion (`credentialSource === 'external-cli'`).
- Leave agent picker wire-format logic as-is (§3.4).
- Verify: claude-code stays agent-only & chat-hidden; its model list resolves from the registry via the normal Pull (no seeder); env stripped. Existing seeder tests deleted; new test covers `listModels` returning the registry catalog for a `registry` provider. **This is the full response to 0xfullex.**

**Phase 2 — #16325 (codex).** First OAuth consumer.
- Generalize `CherryInOauthService` with the loopback transport (§5); codex consumes it. Delete `CodexOauthService`.
- Registry data: provider entry (`modelListSource:'registry'`, `login{…1455…}`, `authConfig.type:'oauth'`, `accountId`) + model rows.
- Add `REQUEST_SHAPERS['openai-codex']` + the single shaper builder in `config.ts`.

**Phase 3 — #16327 (grok).** Pure data + one shaper.
- Registry data (`login{…OIDC, *.x.ai allowlist, 56121…}`) + `REQUEST_SHAPERS['grok-cli']` + the OIDC host validator (code). No new service, no new settings component. PR shrinks from ~900 LOC to ~250.

## 9. Risks / must-not-forget

- **Security:** loopback binds `127.0.0.1` only; strict `state` + one-shot verifier; OIDC discovery host allowlist stays code; never log tokens (`loggerService`); document that refresh tokens sit in `authConfig` (DB) in plaintext.
- **DB writes:** OAuth refresh that updates `authConfig` must go through `application.get('DbService').withWriteTx(fn)`, not a bare transaction.
- **IPC:** the generic OAuth IPC takes a `providerId` — validate it against a registry allowlist of `login`-enabled providers; don't let the renderer trigger OAuth for arbitrary ids.
- **v2 caveat (CLAUDE.md):** schemas / drizzle SQL are throwaway — edit the schema source and regenerate; do not author patch migrations. The registry codegen pipeline (`v2-refactor-temp/tools/data-classify`) is unaffected (these are registry data fields, not preference/bootConfig).
- **Don't over-count identity branches:** some `claude-code` literals are *runtime* identity (agent type, message/tool metadata) and must remain — only *provider-kind* leaks get converted to capabilities.
- **Settings UI:** keep claude-code's bespoke component (terminal launch + probe). codex/grok share one OAuth-login component selected by the presence of `login` config — not by provider id.
