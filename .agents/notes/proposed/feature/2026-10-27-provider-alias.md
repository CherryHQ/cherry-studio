# Agent Note: Editable provider aliases

Status: proposed

English | [中文](2026-10-27-provider-alias.zh.md)

## Problem

Custom providers receive generated IDs. The API Gateway exposes those IDs in model addresses such as `providerId:apiModelId`, which makes several configured providers difficult to distinguish in other clients. Provider names are editable display text and need not be unique. The existing `user_provider.providerId` is an internal primary key referenced by models; editing it would change persistent identities.

## Proposal

Add one nullable `alias` column to `user_provider`, with a unique index, through a new generated migration. Existing rows receive `NULL`; provider IDs, model IDs, preset associations, and existing references remain unchanged. Expose the optional field on the shared `Provider` type and accept it through provider create/update APIs. The provider data layer owns validation and persistence; the field is not Gateway-specific.

Trim surrounding whitespace. An empty value clears the alias to `NULL`; a nonempty alias contains only lowercase ASCII letters, digits, hyphens, and underscores. An omitted update leaves the stored value unchanged. Aliases are unique across enabled and disabled providers. Reject aliases that equal another provider's internal ID or a reserved preset provider ID belonging to another provider. Provider creation must also reject an internal ID already used as another provider's alias. Perform conflict checks and the write in one synchronous write transaction; retain the database uniqueness constraint for aliases.

The existing provider editor exposes an optional field labeled “Provider identifier” / “服务商标识”. Users can set, change, or clear it on creation and on existing editable providers. Show validation and conflict errors without discarding input. Duplicating a provider leaves its alias unset. Renaming the display name does not change the alias. Existing restrictions on managed providers remain in force.

The Gateway advertises `${provider.alias ?? provider.id}:${apiModelId}` in `/v1/models`. At the request boundary, resolve the prefix to a provider by internal ID or alias, then use its internal ID for model lookup, authorization, and execution. Both forms address the same model and retain all existing availability checks. OpenAI, Anthropic, Gemini, and token-counting routes use the same resolution. Response model fields preserve the requested provider prefix with the resolved API model ID, so a request through an alias does not unexpectedly return the internal UUID.

User-facing Gateway configuration generation uses the alias when available. Internal consumers may continue using stable internal IDs. Keep Gateway formatting separate from internal `UniqueModelId` construction, and preserve Gemini CLI suffix and Antigravity path handling. Provider exports may carry `alias` as metadata while retaining internal provider and model IDs; this does not make aliases valid identifiers for every DataApi endpoint.

Changing or clearing an alias takes effect for subsequent requests and listings. Previously configured internal-ID addresses remain valid. Old aliases are not retained as redirect history; external clients using an old alias must update their configuration. No alias mapping table, automatic name-derived alias, primary-key rename, or additional alias consumers are introduced.

## Alternatives considered

- Allow a custom `providerId` only when creating a provider: smaller, but does not let users identify existing providers without recreating them.
- Rename existing provider primary keys: rejected because models and other persistent references use those identities.
- Name the new column `gatewayId`: rejected because the identifier belongs to the provider and may serve other consumers.
- Use `name` as the address prefix: rejected because display names are neither unique nor constrained for routing.
- Add an alias mapping table or redirect history: unnecessary for one current alias per provider and adds ownership and reuse rules.

## Acceptance criteria

- AC1 — A populated database migrates forward without changing provider IDs, model IDs, or references; existing providers have no alias, and a saved alias survives reload. (verification: main database tests)
- AC2 — Create/update accept valid aliases and clearing, preserve an omitted alias, and reject invalid characters, duplicate aliases, alias/internal-ID collisions in both write directions, and reserved preset-ID collisions without partially changing a provider. Disabled providers still reserve their aliases. (verification: shared schema + main database tests)
- AC3 — The provider editor can create, edit, and clear an alias, preserves input after a rejected save, does not copy an alias when duplicating, and keeps display-name changes independent. Labels and validation messages are localized and keyboard accessible. (verification: renderer + Electron)
- AC4 — `/v1/models` advertises the alias when set; alias and internal-ID requests resolve to the same configured model. Unknown, disabled, unavailable, or publicly restricted targets remain rejected through either form. OpenAI, Anthropic, Gemini, and token counting retain existing model-ID normalization. (verification: Gateway tests)
- AC5 — Response model fields and generated user-facing Gateway configurations use the appropriate provider prefix; internal model identities, provider exports' identity fields, Gemini CLI suffix handling, and Antigravity paths remain valid. (verification: affected Gateway and configuration-consumer tests)
- AC6 — Changing or clearing an alias updates subsequent listings and requests while internal-ID addresses keep working; the editor explains that external configurations using the old alias need updating. English and Chinese reference docs describe this compatibility boundary. (verification: Gateway tests + Electron + docs gate)

## Risks

- An alias namespace that overlaps internal or preset IDs could route a request to the wrong provider. Validate both write directions and reserved preset IDs centrally; do not resolve collisions by choosing a lookup order.
- Alias changes invalidate external configurations using the previous alias. Explain the consequence in the editor; retain internal-ID compatibility rather than silently creating redirect history. A released alias can later be assigned to another provider.
- Updating only `/v1/models` would advertise addresses that request parsing or configuration writers cannot use. Verify listing, resolution, response projection, and affected consumers together.
- Migration generation must append to the shipped chain. Test against populated data and do not rewrite existing migrations.
