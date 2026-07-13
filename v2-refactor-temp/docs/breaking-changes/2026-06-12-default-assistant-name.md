---
title: Default assistant and CherryAI defaults are seeded
category: changed
severity: notice
introduced_in_pr: #15943
date: 2026-06-12
---

## What changed

Fresh v2 databases seed a persisted default assistant with the fixed name `Default Assistant`, backed by the managed CherryAI `cherryai::qwen` model. The persisted assistant name no longer follows the app language the way the old synthetic default assistant label did.

The CherryAI default seeder also inserts missing default-model preference rows for:

- `chat.default_model_id`
- `topic.naming.model_id`
- `feature.quick_assistant.model_id`
- `feature.translate.model_id`

Existing preference rows are preserved, including intentional `null` values such as translate's "follow the default model" state.

Topic auto-naming now uses `topic.naming.model_id` instead of the current assistant's model. If that preference is invalid or points to a missing model, topic naming falls back to the managed CherryAI default model.

Settings pickers that still have the legacy renderer default-assistant sentinel now prefer the persisted seeded default assistant when it exists, so fresh installs do not show two `Default Assistant` choices.

The managed CherryAI default model is internal app bootstrap data. It is not listed by the API gateway `/v1/models` endpoint and cannot be invoked through gateway chat/message routes.

## Why this matters to the user

Users who start Cherry Studio in a non-English language may see the initial default assistant named `Default Assistant` instead of a localized name. The assistant remains ordinary user data and can be renamed or deleted.

Existing v2 profiles that are missing one of the default-model preference rows may receive `cherryai::qwen` for that missing row the next time the seeder runs. Existing non-empty values and existing `null` values are not overwritten.

Local API clients should not rely on the CherryAI managed default model as a gateway-accessible model. Select an explicitly configured user/provider model for gateway traffic.

## What the user should do

Nothing — automatic. Rename the default assistant manually if a localized or custom name is preferred.
