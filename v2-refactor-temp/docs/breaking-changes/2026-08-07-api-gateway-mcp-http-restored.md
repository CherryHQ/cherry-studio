---
title: MCP-over-HTTP endpoints restored on the API gateway
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-08-07
---

## What changed

The `/v1/mcps*` endpoints removed in v2.0.0 are back on the API gateway, so external clients can again use Cherry Studio as a local MCP hub:

- `GET /v1/mcps` — the enabled MCP servers, each with the URL to connect to it
- `GET /v1/mcps/:server_id` — server details + tool list
- `POST /v1/mcps/:server_id/mcp` — Streamable HTTP endpoint for any MCP client

They authenticate like every other gateway route (`Authorization: Bearer` / `x-api-key`) and appear in `/openapi`.

Two differences from the v1 endpoints:

- **No sessions.** The proxy is stateless: no `Mcp-Session-Id` is issued, and `GET` on the proxy path returns 405 instead of opening an SSE stream. Standard MCP clients handle this — the spec allows a server not to assign session ids — but server-initiated messages (e.g. `notifications/tools/list_changed`) never reach the client, so a client that caches the tool list must re-list to see changes.
- **Response bodies.** The two `GET` endpoints return plain objects (`{ servers: [...] }`, `{ id, name, type, description, tools }`) instead of v1's `{ success: true, data: ... }` wrapper. Errors use the gateway's standard error envelope.

## Why this matters to the user

Users who ran external automation against Cherry Studio's MCP servers (browser tooling, scripts, other agent hosts) got a 404 on v2.0.0 and had to stay on 1.9.x. Those integrations work again, with a small edit if they parsed the `{ success, data }` wrapper.

## What the user should do

Nothing to enable — the endpoints are live whenever the API gateway is on. Clients written against v1 should drop the `success`/`data` unwrapping and stop relying on `Mcp-Session-Id`.

## Notes for release manager

Supersedes `2026-06-05-api-gateway-mcp-http-removed.md` for the `/v1/mcps*` half; at release time these two entries should be merged into one note rather than announcing a removal and a restoration separately. The Claw agent's MCP transport (`ALL /v1/claw/:agentId/claw-mcp`) is still removed and still needs a product decision.

Addresses issue #17992.
