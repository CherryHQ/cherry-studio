# Agent Note: Editable provider aliases

Status: implemented

English | [中文](2026-10-27-provider-alias.zh.md)

## Problem

Custom providers receive generated IDs. The API Gateway exposes those IDs in model addresses such as `providerId:apiModelId`, which makes several configured providers difficult to distinguish in other clients. Provider names are editable display text and need not be unique. The existing `user_provider.providerId` is an internal primary key referenced by models; editing it would change persistent identities.

## Decision

The provider row stores one nullable `alias` column to `user_provider`, with a unique index, through an appended generated migration. Existing rows receive `NULL`; provider IDs, model IDs, preset associations, and existing references remain unchanged. The shared `Provider` type exposes the optional field, and provider create/update APIs accept it. The provider data layer owns validation and persistence; the field is not Gateway-specific.

The data layer trims surrounding whitespace. An empty value clears the alias to `NULL`; a nonempty alias contains only lowercase ASCII letters, digits, hyphens, and underscores. An omitted update leaves the stored value unchanged. Aliases are unique across enabled and disabled providers. Validation rejects aliases that equal another provider's internal ID or a reserved preset provider ID belonging to another provider. Provider creation also rejects an internal ID already used as another provider's alias. Conflict checks and the write run in one synchronous write transaction, backed by the database uniqueness constraint.

The existing provider editor exposes an optional field labeled “Provider identifier” / “服务商标识”. Users can set, change, or clear it on creation and on existing editable providers. Validation and conflict errors preserve input. Duplicating a provider leaves its alias unset. Renaming the display name does not change the alias. Existing restrictions on managed providers remain in force.

The Gateway advertises `${provider.alias ?? provider.id}:${apiModelId}` in `/v1/models`. At the request boundary, resolve the prefix to a provider by internal ID or alias, then use its internal ID for model lookup, authorization, and execution. Both forms address the same model and retain all existing availability checks. OpenAI, Anthropic, Gemini, and token-counting routes use the same resolution. Response model fields preserve the requested provider prefix with the resolved API model ID, so a request through an alias does not unexpectedly return the internal UUID.

User-facing Gateway configuration generation uses the alias when available. Internal consumers may continue using stable internal IDs. Gateway formatting stays separate from internal `UniqueModelId` construction and preserves Gemini CLI suffix and Antigravity path handling. Provider exports may carry `alias` as metadata while retaining internal provider and model IDs; this does not make aliases valid identifiers for every DataApi endpoint.

Changing or clearing an alias takes effect for subsequent requests and listings. Previously configured internal-ID addresses remain valid. Old aliases are not retained as redirect history; external clients using an old alias must update their configuration. No alias mapping table, automatic name-derived alias, primary-key rename, or additional alias consumers are introduced.

## Alternatives considered

- Allow a custom `providerId` only when creating a provider: smaller, but does not let users identify existing providers without recreating them.
- Rename existing provider primary keys: rejected because models and other persistent references use those identities.
- Name the new column `gatewayId`: rejected because the identifier belongs to the provider and may serve other consumers.
- Use `name` as the address prefix: rejected because display names are neither unique nor constrained for routing.
- Add an alias mapping table or redirect history: unnecessary for one current alias per provider and adds ownership and reuse rules.

## Consequences

The data layer owns a single identifier namespace across internal IDs, aliases, and reserved preset IDs. Conflict checks run before mutation in the same transaction; a unique database index also protects aliases. No primary-key migration or alias mapping table is needed.

Changing or clearing an alias invalidates external configurations that use it. The editor explains this consequence. Internal-ID addresses remain valid, and released aliases can later belong to another provider. Existing records migrate to a null alias without changing their identities.

See [Provider identifiers](../../../../docs/references/provider-model/provider-identifiers.md) for the user-facing compatibility contract.

## Verification

- AC1 — `src/main/data/db/__tests__/applyMigrations.populated.test.ts` migrates a populated production baseline, preserves provider/model identities and foreign keys, and reopens the database with the saved alias; `pnpm db:migrations:check` passes.
- AC2 — `ProviderService.alias.test.ts`, `ProviderService.create.test.ts`, and shared `schemas/__tests__/providers.test.ts` cover trimming, omission, clearing, invalid characters, disabled-provider conflicts, reserved IDs, collisions in both directions, batch rollback, and database uniqueness.
- AC3 — `ProviderEditorDrawer.test.tsx` and the existing `useProviderEditor.test.ts` pass. A real Electron instance with an isolated profile verifies invalid/conflicting input retention, creation, editing, clearing, and reload persistence; `pnpm i18n:check` passes for every locale.
- AC4 — Gateway model, proxy, route, and token-counting tests pass, including alias resolution and public Cloud restrictions. Real HTTP requests through the isolated Electron Gateway exercise OpenAI Chat/Responses, Anthropic, Gemini, both token-count routes, and the Claude context marker and Gemini suffix.
- AC5 — Provider alias database tests verify export identity preservation; Gateway and CLI tests verify addressing, configuration generation, Antigravity paths, and the Gemini CLI sentinel. Real Gateway responses preserve alias and internal-ID request prefixes.
- AC6 — Real Electron edits and HTTP requests verify that changing/clearing an alias immediately updates listings and routing, rejects old aliases, and preserves internal-ID access. English/Chinese reference documentation and `pnpm docs:check` pass.
