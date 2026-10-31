---
description: Editable provider aliases, stable internal identities, and external model-address compatibility
sources:
  - src/main/data/services/ProviderService.ts
  - src/main/data/db/schemas/userProvider.ts
  - src/shared/data/api/schemas/providers.ts
  - src/main/features/apiGateway/utils/models.ts
  - src/renderer/pages/settings/ProviderSettings/ProviderList
  - src/renderer/pages/code/cliConfig
---

# Provider identifiers

English | [中文](./provider-identifiers.zh.md)

Each provider has a stable internal `providerId`, exposed as `Provider.id`. Models and other persisted references use this identity. The optional `alias` belongs to the provider configuration; it does not rename the internal ID or depend on the display name.

## Configure an alias

In the provider editor, use **Provider identifier** when creating or editing a provider. Leave it empty to use the internal ID. Duplicating a provider starts with an empty alias. Managed providers retain their existing editing restrictions.

Aliases contain lowercase ASCII letters, digits, hyphens, or underscores. Surrounding whitespace is trimmed, and an empty value clears the alias. An omitted API update preserves the saved alias. Storage uses a nullable column with a unique index.

An alias must not belong to another provider, including a disabled one, or equal another provider's internal ID or a reserved preset provider ID. Creating a provider also checks that its internal ID is not another provider's alias. The data layer validates these rules and writes in one transaction; rejected updates preserve the previous provider configuration.

## External model addresses

The API Gateway lists models as `alias:apiModelId` when an alias is set and `providerId:apiModelId` otherwise. Both forms resolve to the same internal model, with the same availability and authorization checks. OpenAI, Anthropic, Gemini, and token-counting routes share this lookup. Response model fields preserve the requested provider prefix and use the resolved API model ID.

New user-facing Gateway configurations use the current alias. Gemini CLI suffixes and Antigravity model paths keep their existing formats. Internal consumers can continue using stable internal IDs. Provider exports include the alias as metadata while preserving their provider and model identity fields. Other DataApi endpoints still require internal IDs unless explicitly documented otherwise.

Changing or clearing an alias takes effect for subsequent listings and requests. External configurations using the previous alias must be updated. Internal-ID addresses keep working. Old aliases are not redirects and may be assigned to another provider after release.

Existing databases receive `NULL` aliases through an appended migration; provider IDs, model IDs, and their references remain unchanged.
