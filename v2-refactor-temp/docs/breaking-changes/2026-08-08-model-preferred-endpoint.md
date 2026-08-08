---
title: Models can pin the endpoint their requests use
category: added
severity: notice
introduced_in_pr: "#17383"
date: 2026-08-08
---

## What changed

A model on a provider that serves more than one chat protocol (doubao, dashscope, deepseek, azure-openai, and multi-endpoint aggregator models) now shows a **Preferred Endpoint** choice in the model drawer. Exactly one endpoint is always selected, and requests for that model use it.

Routing resolves as `preferredEndpointType` → the first supported endpoint → the provider default, so models without an explicit choice behave exactly as before. Refreshing a provider's model list updates which endpoints a model supports without overwriting a choice the user made.

Migrating from v1 now carries the model's v1 `endpoint_type` across as the preferred endpoint. Previously it was merged into the supported-endpoint list, where a model whose v1 route was not first in `supported_endpoint_types` silently moved to a different protocol on upgrade.

## Why this matters to the user

Endpoint choice controls request format, response parsing, reasoning dialect, and which provider-native tools (built-in web search, URL context) are available. Users on providers that expose several protocols can now select one deliberately instead of inheriting whatever order the model metadata happened to have.

## What the user should do

Nothing — automatic. To change a model's protocol, open Settings → Providers → the model, and pick an endpoint.

## Notes for release manager

New `preferred_endpoint_type` column on `user_model` (migration `0007_military_random.sql`, additive and nullable). New i18n key `settings.models.add.preferred_endpoint.label`.
