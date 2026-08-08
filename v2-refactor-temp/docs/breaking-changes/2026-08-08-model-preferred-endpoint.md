---
title: Models can pin the endpoint their requests use
category: added
severity: notice
introduced_in_pr: "#17383"
date: 2026-08-08
---

## What changed

A model on a provider that serves more than one chat protocol (doubao, dashscope, deepseek, azure-openai, and multi-endpoint aggregator models) now shows a **Preferred Endpoint** choice in the model drawer. Exactly one endpoint is always selected, and requests for that model use it.

On aggregators (CherryIN, New API, AiOnly) this **replaces** the multi-select the edit drawer used to show. That control listed all eight protocols regardless of what the model actually speaks, and every edit overwrote the endpoint set the provider's own `/models` listing reported. Editing now offers exactly the protocols upstream reported for that model and changes only the route — the supported set stays as the provider reported it, which also keeps the code-agent, painting and TTS model filters reading the provider's answer instead of whatever was last clicked. Adding a model by hand is unchanged: with no upstream listing to go on, you still declare the set yourself.

Routing resolves as `preferredEndpointType` → the first supported endpoint → the provider default, so models without an explicit choice behave exactly as before. Refreshing a provider's model list updates which endpoints a model supports without overwriting a choice the user made.

Existing models are untouched: the new column starts empty for every stored model, so they keep routing on their supported-endpoint order exactly as before. Nothing is backfilled — an upgrade must not invent a preference the user never expressed.

Migrating from v1 now carries the model's v1 `endpoint_type` across as the preferred endpoint. Previously it was merged into the supported-endpoint list, where a model whose v1 route was not first in `supported_endpoint_types` silently moved to a different protocol on upgrade. **This applies only to users who migrate v1 → v2 from this version onward** — the v1 migrator does not re-run for anyone already on v2, and their original `endpoint_type` is no longer recoverable. Those users keep today's behavior and can set the endpoint by hand in the model drawer.

## Why this matters to the user

Endpoint choice controls request format, response parsing, reasoning dialect, and which provider-native tools (built-in web search, URL context) are available. Users on providers that expose several protocols can now select one deliberately instead of inheriting whatever order the model metadata happened to have.

## What the user should do

Nothing — automatic. To change a model's protocol, open Settings → Providers → the model, and pick an endpoint.

## Notes for release manager

New `preferred_endpoint_type` column on `user_model` (migration `0007_military_random.sql`, additive and nullable). New i18n key `settings.models.add.preferred_endpoint.label`.
