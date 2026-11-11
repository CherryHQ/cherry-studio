# Agent Note: Responses tools opt out of default strict mode

Status: implemented

English | [中文](2026-11-02-responses-tool-strict-default.zh.md)

## Problem

The OpenAI Responses API treats a function tool without `strict` as strict when it can, and Azure OpenAI documents `strict` as defaulting to `true`. Strict mode marks every property required. Cherry's built-in and MCP tools intentionally omit `strict` (#18179), so on models routed to the Responses endpoint, including Azure `azure-responses` deployments, every optional argument became required. The built-in Sequential Thinking tool starts a chain without `chainId`; the model invented one, and the server rejected the call.

## Decision

`toolSchemaCompatibility` gives every function tool whose `strict` is undefined an explicit `strict: false` when the resolved endpoint is `openai-responses`. Tools that set `strict` explicitly keep their value. Other endpoints receive no `strict` key they did not request. Input schemas and their `required` lists are unchanged. The API gateway already sends `strict: false` for OpenAI Responses targets (#23382).

## Alternatives considered

- Restoring `strict: true` on built-in tools repeats the failures that #18179 removed: Anthropic compiles all strict schemas into one grammar and rejects requests over its limit, and optional fields need placeholder values. It also leaves MCP tools uncovered.
- Sending `strict: false` on every endpoint breaks strict-unaware upstreams such as Bedrock, which reject the extra key (#23378).
- Rewriting each MCP schema into strict form (all properties required and nullable) changes third-party argument semantics.
- Patching only Azure leaves OpenAI and other Responses providers with the same default.

## Consequences

Responses models see optional tool arguments as optional again. Tool calls on Responses are no longer grammar-constrained unless the tool sets `strict: true`. Requests that Cherry sends to a non-Responses endpoint are unchanged, even when an upstream relay forwards them to Responses.

## Verification

- Regression — `src/main/ai/runtime/aiSdk/params/features/__tests__/toolSchemaCompatibility.test.ts`: an Azure Responses request sends `strict: false` with the original `required` list for a tool without `strict` and keeps an explicit `strict: true`; Chat Completions and Anthropic Messages requests carry no `strict` key for a non-strict tool.
