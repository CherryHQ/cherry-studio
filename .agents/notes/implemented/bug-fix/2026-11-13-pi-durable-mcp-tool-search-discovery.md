# Agent Note: Load deferred Pi Durable MCP tools through search

Status: implemented

English | [中文](2026-11-13-pi-durable-mcp-tool-search-discovery.zh.md)

## Problem

Ordinary MCP tools were registered with `callers: ['tools']`. Codemode could call them, but native `tool_search` only searches deferred, model-callable tools. Tools-only registration excluded them from discovery and loading.

## Decision

Register every MCP tool with `callers: ['model', 'tools']` and defer ordinary servers. Native `tool_search` finds and loads them for direct model calls. Scripts discover and call them through codemode before and after loading. `automation` stays offered upfront. The installed type accepts only `deferred: true` or an omitted value, so automation uses `undefined`.

## Alternatives considered

- Widening `callers` or `offeredTools` semantics in the vendored dependency patch would let loading override tools-only eligibility across the harness. It contradicts the installed contract and changes unrelated registrations to fix a local registration mismatch.
- Adding only `deferred: true` leaves tools-only registrations outside native search candidates.

## Consequences

Ordinary MCP tools leave codemode's inline prompt catalog while staying discoverable and script-callable. After loading they are directly model-callable. Direct and nested calls still pass the shared approval gate; loading does not grant approval. Automation exposure and annotation-based replay safety remain unchanged.

## Verification

- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/runtime/piDurable/durableMcp.test.ts`: real Harness, QuickJS codemode and linked MCP execution catch missing pre-load discovery or calls, search that reports loading without enabling direct execution, broken post-load scripts, and configuration-disabled tools exposed through search or scripts; existing automation result and replay checks remain intact.
