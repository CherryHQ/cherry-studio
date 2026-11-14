# Agent Note: Preserve MCP OAuth state and loopback redirect compatibility

Status: implemented

English | [中文](2026-11-10-mcp-oauth-state-and-redirect.zh.md)

## Problem

MCP authorization depends on a CSRF state value and an exact registered redirect URI. The OAuth SDK may omit the optional state parameter from its generated authorization URL, and some MCP providers allowlist `localhost` rather than `127.0.0.1`.

## Decision

Before opening an authorization URL, the MCP OAuth provider requires its persisted state and sets that value on the URL. If no state was persisted, the authorization attempt fails without opening a browser. New client registrations use `localhost`; saved clients keep their registered loopback URI during authorization and code exchange. Metadata-less legacy clients keep the previous `127.0.0.1` URI. Selection is isolated per authorization flow and reloaded from the issuer-bound saved client on a restarted callback. The callback server remains bound to `127.0.0.1`.

## Alternatives considered

- Trust the SDK-generated URL to contain state: rejected because the SDK's provider state hook is optional and a missing state lets the authorization server reject the request.
- Keep `127.0.0.1` as the advertised redirect host: rejected because providers that allowlist `localhost` require an exact matching redirect URI.

## Consequences

- MCP authorization requests always carry the same state stored for callback validation; an incomplete request fails before the browser opens.
- New registrations advertise `localhost`, while existing registrations retain their exact URI. The local callback listener remains restricted to IPv4 loopback.

## Verification

- Regression — `pnpm test:main src/main/ai/mcp/oauth/__tests__/provider.test.ts`: authorization redirects include persisted state, missing state blocks the browser launch, and new client metadata uses `localhost`. The SDK protocol regression also checks saved IPv4, metadata-less legacy, saved localhost, and new registrations through authorization and a restarted callback. Concurrent issuer selections remain isolated. This uses intercepted protocol requests, not live-provider or real-browser sign-in.
