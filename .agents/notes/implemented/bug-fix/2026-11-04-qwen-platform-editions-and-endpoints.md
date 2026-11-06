# Agent Note: Qwen platform editions and saved endpoints

Status: implemented

English | [中文](2026-11-04-qwen-platform-editions-and-endpoints.zh.md)

## Problem

The platform rebrand leaves saved official endpoint overrides on the previous
domains. The v1 edition exemption also exposes the other site's provider after
an upgrade, even when its catalog metadata excludes the running edition.

## Decision

- Keep the `dashscope` and `qwencloud` identities, with their existing credentials
  and model bindings. Enforce their catalog edition restrictions for canonical
  providers, preset-derived copies, and v1 users at the provider service boundary.
- Keep the v1 exemption for unrelated providers and leave fully custom,
  preset-free providers under the existing rules.
- Append migration `0034_qwen_endpoint_hosts` for saved official URLs. Apply the
  same mapping during v1 import after historical-default delta projection, so
  imported overrides cannot reintroduce the old domains.
- Update localized platform names and the four API-key/model-selection links.
  Source-attribution headers and Token Plan presets are outside this change.
- Qwen-family models on these platforms reuse their provider's new mark: blue
  for `dashscope`, purple for `qwencloud`, with the existing dark-mode assets.
  Model management, discovery, and selection pass preset identity for copies;
  other model families retain their own icons.

## Alternatives considered

- Updating only catalog defaults leaves explicit old official URLs unchanged.
- Removing the v1 exemption for every provider changes unrelated compatibility.
- Moving old providers to the other site's identity would silently change key
  ownership and model bindings; hidden records remain intact instead.

## Consequences

The [provider registry reference](../../../../docs/dev/references/provider-model/provider-registry.md)
owns the availability and URL mapping contract. A hidden provider becomes
available again in its supported edition without deleting or recreating data.
No public API, database column, or user setting is added.

The migration replaces only literal official hostnames in HTTP(S) endpoint
URLs. It preserves the rest of the original spelling, including explicit
default ports and the terminal `#` used by custom full endpoints. URLs with
ASCII whitespace/control characters, backslashes, or invalid ports are left
untouched rather than repaired. The migration is idempotent and does not
continuously rewrite URLs subsequently entered by users.

## Verification

- Regression — `ProviderService.edition.test.ts`: both editions, fresh/v1 profiles, preset copies, provider/model visibility, creation, runtime rejection, and persistence of hidden credentials and models.
- Regression — `qwenEndpointMigration.test.ts`: populated migrate-forward, repeated migration, exact-host matching, URL suffix preservation, proxy exclusions, unchanged credentials/models, and v1 URL-normalization cases.
- Regression — `ProviderModelMigrator.test.ts`: v1 import updates both official hosts while retaining a custom proxy, API key, and model binding.
- Regression — Provider configuration and DashScope transport tests cover chat-derived image origins, custom hosts, request settings, and native image transport.
- Regression — Provider registry source-sync, endpoint-matrix, and Alibaba catalog tests verify generated provider metadata and existing model contracts.
- Regression — `logo.test.ts` verifies platform-specific Qwen marks, preset copies, composite IDs, and preservation of other model brands; model-list and selector tests cover the affected consumers.

These checks use local test fixtures. Live vendor requests and desktop UI
acceptance are separate from this automated verification.
