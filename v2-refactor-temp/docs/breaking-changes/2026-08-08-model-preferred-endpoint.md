---
title: Models can pin the endpoint their requests use
category: changed
severity: notice
introduced_in_pr: "#17383"
date: 2026-08-08
---

## What changed

A model on a provider that serves more than one chat protocol (doubao, dashscope, deepseek, azure-openai, and multi-endpoint aggregator models) now shows a **Preferred Endpoint** choice in the model drawer. The drawer always displays the effective route. A preference is persisted only after the user chooses one; otherwise requests fall through the rest of the resolution order.

The edit drawer now has two separate controls. **Endpoint Type** still edits the protocols the model supports — the set the code-agent, painting and TTS filters read — and it is narrowed to the protocols the provider actually serves for the model's operations, instead of listing all eight regardless. **Preferred Endpoint** is the new one, and it changes only the route. Adding a model by hand is unchanged: with no upstream listing to go on, you declare the supported set yourself, and the route pin appears once that declaration offers a choice.

Routing resolves as `preferredEndpointType` → the provider's default chat endpoint when the model declares it → the first supported endpoint the provider still serves → the gateway route → the provider default. Refreshing a provider's model list updates which endpoints a model supports without overwriting a choice the user made. The full order lives in `docs/references/ai/provider-resolution.md`.

Generated OpenCode, Pi, and Hermes configurations also honor a preferred endpoint when the CLI supports it and the provider serves it. Changing or clearing a preference invalidates the model's previous health-check result, so the newly selected route must be checked again.

Existing models are untouched by the new column: it starts empty for every stored model, and nothing is backfilled — an upgrade must not invent a preference the user never expressed. Their route can still change, because the provider default now outranks the declared order (see the separate entry for that).

Migrating from v1 now carries the model's v1 `endpoint_type` across as the preferred endpoint. Previously it was merged into the supported-endpoint list, where a model whose v1 route was not first in `supported_endpoint_types` silently moved to a different protocol on upgrade. This applies to new v1 → v2 migrations and to an explicit migration rerun from retained v1 sources in Settings → Data. A rerun discards the current v2 data, so create a full backup and follow the confirmation flow first. Users who do not rerun keep today's behavior and can set the endpoint by hand in the model drawer.

## Why this matters to the user

Endpoint choice controls request format, response parsing, reasoning dialect, and which provider-native tools (built-in web search, URL context) are available. Users on providers that expose several protocols can now select one deliberately instead of inheriting whatever order the model metadata happened to have.

## What the user should do

Nothing is required. To change a model's protocol, open Settings → Providers → the model, and pick an endpoint; pick **Inherit** to hand routing back to the provider default and the supported-endpoint order.

One exception to "automatic": users already on v2 do not get their v1 `endpoint_type` back on upgrade, because the v1 migrator does not re-run. Recovering it means an explicit migration rerun from retained v1 sources in Settings → Data, which discards current v2 data — back up first. Setting the endpoint by hand is the cheaper path.

## Notes for release manager

New `preferred_endpoint_type` column on `user_model` (migration `0021_broken_doorman.sql`, additive and nullable). New i18n keys under `settings.models.add.preferred_endpoint.*`: `label`, `tooltip`, `inherit`, `inherit_resolved`.

Grep for the column rather than trusting this filename: the branch regenerates its migration on every merge that appends one upstream, and this note has drifted before.
