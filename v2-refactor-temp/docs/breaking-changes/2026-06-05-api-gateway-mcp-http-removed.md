---
title: MCP-over-HTTP endpoints removed from the API gateway
category: removed
severity: breaking
introduced_in_pr: #15705
date: 2026-06-05
---

## What changed

The v1 API server exposed MCP (Model Context Protocol) over HTTP for agents. The v2 API gateway (ported in #15705) does not carry these endpoints over, so they now return 404:

- `GET /v1/mcps` — list active MCP servers
- `GET /v1/mcps/:server_id` — MCP server info + tool list
- `ALL /v1/claw/:agentId/claw-mcp` — the Claw agent's Streamable-HTTP MCP transport (session create/init/timeout/close + JSON-RPC dispatch)

A v1 agent-deletion hook for tearing down a Claw MCP server (`cleanupClawServer`) is also absent — though it was already uncalled dead code in the v1 tree, so its removal orphans no live call site.

## Why this matters to the user

Any external client or agent that talked to Cherry Studio's MCP servers over HTTP — listing MCP servers, fetching their tools, or connecting to the Claw agent's MCP transport — will get a 404 against the v2 gateway. In-app MCP usage (MCP servers consumed inside Cherry Studio's own AI runtime) is unaffected; only the HTTP-exposed surface for external agents was removed.

## What the user should do

TBD — pending product decision on whether MCP-over-HTTP returns in a later v2 release. For now there is no HTTP replacement; MCP must be consumed in-app rather than over the gateway.

## Notes for release manager

The v2 data services backing the read endpoints still exist (`mcpServerService`, `McpCatalogService`), so `/v1/mcps` and `/v1/mcps/:id` are a thin re-port if we decide to restore them. The Claw Streamable-HTTP transport is the heavier piece — it needs its session/lifecycle machinery rebuilt in the gateway. (The old `cleanupClawServer` deletion hook was already dead code, so there is no existing hook to re-home — a restored transport would need its teardown written fresh.) Confirm with the agents owner whether any shipped agent flow depends on the Claw HTTP transport before finalizing this as a permanent removal.
