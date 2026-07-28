---
title: API gateway model id uses a single-colon `providerId:modelId` separator
category: changed
severity: breaking
introduced_in_pr: #15705
date: 2026-06-06
---

## What changed

When calling the local API gateway, the `model` field is now parsed as `providerId:modelId`, split on the **first** `:`. The v1 server split the provider and model on a double-colon `::`. So a request that used to send `"model": "openai::gpt-4o"` must now send `"model": "openai:gpt-4o"`; the provider id is everything before the first colon, the model id is everything after it (so a model id may itself contain colons).

## Why this matters to the user

Any external client, script, or agent that points at Cherry Studio's gateway (`/v1/chat/completions`, `/v1/messages`, `/v1/responses`) and hard-codes the `provider::model` form will now fail model resolution — the whole `provider::model` string is treated as the provider id and the leading `:` makes the model id invalid, yielding an `Invalid model format` error.

## What the user should do

Update the `model` value from `provider::model` to `provider:model` (single colon). Configure clients to use the model ids shown in Cherry Studio's gateway/model list, which already use the single-colon form.

## Notes for release manager

Parsing lives in `src/main/features/apiGateway/services/ProxyStreamService.ts` (`indexOf(':')`). A leading or trailing colon (`":m"` / `"p:"`) is rejected with `Invalid model format`. Covered by the model-id parse tests in `services/__tests__/ProxyStreamService.parse.test.ts`.
