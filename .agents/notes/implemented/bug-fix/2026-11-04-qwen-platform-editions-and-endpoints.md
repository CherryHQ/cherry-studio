# Agent Note: Qwen platform branding and default endpoints

Status: implemented

English | [中文](2026-11-04-qwen-platform-editions-and-endpoints.zh.md)

## Problem

Provider names, links, model logos, and default endpoints need to reflect the
Qianwen AI Platform and Qwen Cloud branding without overwriting user configuration.

## Decision

- Keep the `dashscope` and `qwencloud` identities, credentials, model bindings,
  and existing edition availability rules, including the v1 edition exemption.
- Update localized platform names and API-key/model-selection links.
- Update default endpoints through provider configuration and image transport
  defaults. Preserve saved endpoint overrides, including legacy official URLs.
- Qwen-family models on these platforms reuse the corresponding provider logo,
  including preset-derived copies and dark-mode variants.

## Alternatives considered

- Automatically rewriting saved official URLs would expand a branding update
  into a data migration. Keep user overrides instead.
- Adding Qwen-specific edition restrictions would change access for existing
  users. Keep the existing availability policy instead.

## Consequences

No database migration or v1 import conversion is added. Existing v1 default
projection continues to omit unchanged historical defaults so they inherit
current catalog defaults; explicit overrides remain user-owned.

## Verification

- Regression — `ProviderModelMigrator.test.ts`: existing v1 default projection and override preservation.
- Regression — `ProviderService.edition.test.ts`: existing edition availability and v1 exemption.
- Regression — provider configuration, image transport, and registry tests: default endpoint resolution and catalog consistency.
- Regression — `logo.test.ts`: platform-specific Qwen logos, preset copies, and preservation of other model brands.
