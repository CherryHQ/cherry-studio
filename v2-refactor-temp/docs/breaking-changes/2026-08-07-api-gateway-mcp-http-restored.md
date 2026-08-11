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

Four differences from the v1 endpoints:

- **Sessions are opt-in.** A client that sends `initialize` gets an `Mcp-Session-Id` and may hold a `GET` stream for server-initiated messages, including `tools/list_changed` and tool progress. A client that just POSTs a method without handshaking — what plain `curl` and some v1 scripts do — is still served, one request at a time, gets 405 on `GET`, and is told up front that `tools.listChanged` is unavailable so it re-lists instead of waiting for a notification.
- **Sessions are capped and expire.** The handshake is compatible with v1, but the lifecycle is not: at most 64 sessions exist at once, and one goes away after 30 minutes with no traffic in either direction. v1 kept every session forever. So a client can now get a `503` during a burst, or a `404` on a session it left idle, and must re-`initialize` in both cases — clients that assume a session id is valid indefinitely need a retry path.
- **Browser callers must be local.** As the MCP transport spec requires, a request carrying an `Origin` that is not a loopback address is rejected with 403, so a malicious web page cannot drive this endpoint through a browser that already holds gateway credentials. Native clients send no `Origin` and are unaffected.
- **Response bodies.** The two `GET` endpoints return plain objects (`{ servers: [...] }`, `{ id, name, type, description, tools }`) instead of v1's `{ success: true, data: ... }` wrapper. Errors use the gateway's standard error envelope.

## Why this matters to the user

Users who ran external automation against Cherry Studio's MCP servers (browser tooling, scripts, other agent hosts) got a 404 on v2.0.0 and had to stay on 1.9.x. Those integrations work again, with a small edit if they parsed the `{ success, data }` wrapper.

## What the user should do

Nothing to enable — the endpoints are live whenever the API gateway is on. Clients written against v1 should drop the `success`/`data` unwrapping, and should re-`initialize` when a request comes back `404` (session expired) or `503` (server at capacity) rather than treating a session id as permanent.

## Notes for release manager

Supersedes `2026-06-05-api-gateway-mcp-http-removed.md` for the `/v1/mcps*` half; at release time these two entries should be merged into one note rather than announcing a removal and a restoration separately. The Claw agent's MCP transport (`ALL /v1/claw/:agentId/claw-mcp`) is still removed and still needs a product decision.

Addresses issue #17992.
