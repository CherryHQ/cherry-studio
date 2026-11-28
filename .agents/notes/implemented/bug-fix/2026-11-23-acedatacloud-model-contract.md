# Agent Note: Ace Data Cloud model contracts

Status: implemented

English | [中文](2026-11-23-acedatacloud-model-contract.zh.md)

## Problem

The Ace Data Cloud preset used an OpenAI-only service path. Its generic model list mixed chat and media IDs and did not declare each model's protocol. Matching those IDs to another provider's catalog could also supply unrelated prices, limits and tool capabilities.

## Decision

Use the existing provider-owned model resolution and endpoint types. Intersect the authenticated gateway IDs with the public typed chat catalog, preserve image-capable chat models, and select their published Chat Completions, Responses or Messages endpoint. The Messages transport converts the selected SDK credential to Bearer authentication while preserving the existing fetch transport and request body. Custom hosts retain their configured behavior.

Keep the existing tool-capability check and model update behavior. A model imported without published tool metadata has no function-calling capability until a user sets it. An untyped model uses the provider's configured chat endpoint.

## Alternatives considered

- Copy a vendor catalog or add every gateway ID to Chat Completions: rejected because names do not establish API compatibility or prices.
- Enable tool attempts when the public catalog omits tool metadata. This can attach tools to plain chats without a model capability declaration.
- Store a default endpoint on every untyped model. It can override a user's configured custom host.

## Consequences

Existing model settings control tool availability. New official model IDs can appear on the next model refresh. Failed metadata validation preserves the existing error and retry flow.

## Verification

- Regression — Main provider tests exercise typed discovery, native Messages Bearer authentication, and a custom Responses host's discovery and endpoint selection.
- Regression — The SQLite test covers an untyped model, endpoint fallback, and editing its vision capability without enabling tools.
- Regression — Provider-registry tests cover catalog invariants, endpoint contracts and forward compatibility. Native paid inference and a packaged application UI run were not performed.
