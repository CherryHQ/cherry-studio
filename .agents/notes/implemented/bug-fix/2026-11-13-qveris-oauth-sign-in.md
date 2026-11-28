# Agent Note: QVeris hosted MCP OAuth sign-in with API-key fallback

Status: implemented

English | [中文](2026-11-13-qveris-oauth-sign-in.zh.md)

## Problem

The QVeris built-in MCP server (`https://mcp.qveris.ai/mcp`) originally required `QVERIS_API_KEY` before the server could even be enabled: `McpServerService` rejected activation without it, a renderer modal blocked the toggle, and `resolveBuiltinExternalMcpServer` threw. QVeris's hosted MCP endpoint now also supports MCP OAuth sign-in (RFC 9728 protected-resource metadata → `https://auth.qveris.ai`, dynamic client registration, PKCE public client), so a static API key is no longer the only credential — and it is also the more fragile one.

## Decision

OAuth is the primary credential; `QVERIS_API_KEY` is a fallback:

- **Factory** (`src/main/ai/mcp/servers/factory.ts`): the preset no longer throws without a key. A configured key is attached as a fallback `Authorization: Bearer` header; an empty key leaves headers alone so the server's `401` challenge drives OAuth.
- **Connection** (`src/main/ai/mcp/connections/ExternalMcpConnection.ts`): `prefersOAuth` keeps the OAuth provider attached for the built-in QVeris server (`installSource === 'builtin'`) even when a Bearer header exists. A cached OAuth token overrides the static header via the SDK's `_commonHeaders()`.
- **Credential isolation**: when OAuth is preferred, the fallback Bearer header is stripped from `requestInit.headers`. The SDK's `createFetchWithInit` would otherwise leak it onto OAuth discovery, DCR, and `POST /oauth/token` requests, which the QVeris authorization server rejects with `401 invalid_client` ("HTTP Basic client authentication is required"). The fallback header is re-attached only for requests to the MCP resource URL that do not already carry an OAuth `Authorization` header.
- **Interactive sign-in**: `mcp.server.refresh_tools` forwards the caller's `senderId` through `McpCatalogService.refreshTools` into `McpRuntimeService.listToolsWithContext`, so toggling QVeris on in settings can open the sign-in browser instead of hitting the background callers' non-interactive `UnauthorizedError` dead end.
- **Renderer**: the API-key gate and `QVerisApiKeyGuide` modal are removed; activation is no longer blocked without a key. Built-in server descriptions in all locales state OAuth first, API key second.
- **Server key**: `McpRuntimeService.getServerKey` hashes the connection config (including env/headers) with SHA-256 so the API key never sits in plain text in runtime map keys.

## Alternatives considered

- Keep requiring `QVERIS_API_KEY`: rejected — OAuth is the provider-supported sign-in and avoids long-lived static keys.
- Drop API-key support entirely: rejected — the key remains a valid fallback for users who cannot complete a browser flow, and OAuth tokens already take precedence when present.
- Keep the Bearer header in `requestInit` and strip it per OAuth request inside a wrapped fetch: rejected — the SDK builds its OAuth fetch chain from `requestInit`, so per-endpoint stripping is where the leak actually occurs; stripping at construction is simpler and total.
- Match QVeris by name only in `prefersOAuth`: rejected — a manually created server named `@cherry/qveris` should follow generic header-based behavior, not built-in OAuth preference.

## Consequences

First activation with no key opens the browser for OAuth sign-in; with a key set, the key authenticates immediately and a later OAuth sign-in supersedes it. If the key is revoked, the resulting `401` falls through to OAuth automatically in interactive contexts. Refresh and token exchange never carry the static header. Manual servers with an Authorization header keep the previous non-OAuth path unchanged.

## Verification

- Regression — `pnpm test:main src/main/ai/mcp/connections/__tests__/ExternalMcpConnection.test.ts`: covers `prefersOAuth` builtin gating, OAuth token priority over the fallback key, clean refresh, and asserts no `Authorization` header reaches discovery/registration/token endpoints (including the AS-side `401 invalid_client` rejection of any Bearer header on `/oauth/token`).
- Regression — `pnpm test:main src/main/ai/mcp/servers/__tests__/factory.test.ts src/main/ai/mcp/__tests__/McpCatalogService.test.ts src/main/ai/mcp/__tests__/McpRuntimeService.test.ts src/main/ipc/handlers/__tests__/mcp.test.ts src/main/data/services/__tests__/McpServerService.test.ts`: factory fallback header, `listToolsWithContext` windowId threading, hashed secret-free server key, IPC `senderId` forwarding, and keyless activation.
- Regression — `pnpm test:renderer src/renderer/pages/settings/McpSettings/__tests__/McpSettings.test.tsx src/renderer/pages/settings/McpSettings/__tests__/McpServerCard.test.tsx src/renderer/pages/settings/McpSettings/__tests__/McpServerFields.test.tsx` and `pnpm test:shared src/shared/data/presets/__tests__/mcpServers.test.ts`: gate removal and preset shape.
- Gates — `pnpm test:lint`, `pnpm typecheck`, `pnpm i18n:check`, `pnpm i18n:unused:check`, `oxfmt --check` on changed files, `pnpm docs:check`.
