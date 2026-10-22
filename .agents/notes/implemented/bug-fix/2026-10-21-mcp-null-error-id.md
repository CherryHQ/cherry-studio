# Agent Note: Connect legacy MCP servers that reject probe IDs

Status: implemented

English | [中文](2026-10-21-mcp-null-error-id.zh.md)

## Problem

A legacy MCP server may reject the string ID in Cherry Studio's `server/discover` probe with an HTTP 200 JSON-RPC error whose ID is `null`. The core schema rejected that error; accepting it alone still left the HTTP transport unable to match `null` to the outstanding request. The probe then failed or timed out before Cherry Studio could try legacy `initialize`.

## Decision

Allow a nullable ID only on JSON-RPC error responses. For a Streamable HTTP POST containing exactly one request and returning exactly one null-ID error response, associate that response with the request ID from the same POST. The existing probe classifier then recognizes the error as legacy evidence and proceeds to `initialize`.

## Alternatives considered

- Widening application fallback for every unusable 2xx reply would treat malformed responses as legacy and defer the failure to `initialize`.
- Changing only the error schema leaves the response unmatched and the probe waiting until timeout.
- Rewriting every probe to use numeric IDs changes request generation globally and does not honor the server's valid null-ID error response.

## Consequences

The compatibility fix is limited to single-request, single-response Streamable HTTP exchanges; batch or multi-response null-ID errors remain unassociated. The version-pinned SDK patches should be rechecked when MCP SDK versions change.

## Verification

- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/mcp/connections/__tests__/ExternalMcpConnection.test.ts`: a mock legacy server returns the reported HTTP 200 null-ID parse error, then accepts `initialize`; the client connects in legacy mode and lists its tool.
