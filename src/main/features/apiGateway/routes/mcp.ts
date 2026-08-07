import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { createMcpBridgeServer } from '@main/ai/mcp/createMcpBridgeServer'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { McpServer } from '@shared/data/types/mcpServer'
import { Elysia } from 'elysia'
import * as z from 'zod'

import { DOC_DESCRIPTIONS, DOC_TAGS } from '../openapiDocs'

const logger = loggerService.withContext('McpRoutes')

const ServerIdParamSchema = z.object({ server_id: z.string().min(1) })

/** Resolve by id or name (v1 accepted both), 404 via the global `onError` when absent. */
function resolveServer(idOrName: string): McpServer {
  const server = mcpServerService.findByIdOrName(idOrName)
  if (!server) throw DataApiErrorFactory.notFound('McpServer', idOrName)
  return server
}

/**
 * `/v1/mcps` — exposes the user's configured MCP servers over HTTP so external
 * clients can use Cherry Studio as a local MCP hub (issue #17992; the v1
 * endpoints this restores are documented in
 * `v2-refactor-temp/docs/breaking-changes/2026-06-05-api-gateway-mcp-http-removed.md`).
 *
 * The proxy runs **stateless**: no `Mcp-Session-Id` is issued and a fresh bridge +
 * transport is built per request. The expensive resource — the upstream MCP client —
 * is cached by `McpRuntimeService` either way, so this costs nothing and removes the
 * session map v1 never evicted. The tradeoff is that server→client push is gone
 * (`GET` returns 405), which is why every handler warms the tools cache first: the
 * bridge's `tools/list` reads cache-only and can no longer self-heal via the
 * `tools/list_changed` relay.
 *
 * `detail.tags`/`summary` hold i18n *keys*, not translated text — see chat.ts.
 */
export const mcpRoutes = new Elysia({ prefix: '/mcps' })
  .get(
    '/',
    ({ request }) => {
      const origin = new URL(request.url).origin
      const { items } = mcpServerService.list({ isActive: true })
      return {
        servers: items.map((server) => ({
          id: server.id,
          name: server.name,
          // Always `streamableHttp`: this is the transport the client speaks to *us*,
          // regardless of how Cherry Studio reaches the server upstream.
          type: 'streamableHttp' as const,
          description: server.description,
          url: `${origin}/v1/mcps/${server.id}/mcp`
        }))
      }
    },
    {
      detail: { tags: [DOC_TAGS.cherry], summary: 'List MCP Servers', description: DOC_DESCRIPTIONS.list_mcp_servers }
    }
  )
  .get(
    '/:server_id',
    async ({ params }) => {
      const server = resolveServer(params.server_id)
      // Never rejects — a dead server degrades to an empty tool list rather than a 5xx.
      await application.get('McpCatalogService').warmToolsCache(server.id)
      return {
        id: server.id,
        name: server.name,
        type: server.type,
        description: server.description,
        tools: application.get('McpCatalogService').listTools(server.id)
      }
    },
    {
      params: ServerIdParamSchema,
      detail: { tags: [DOC_TAGS.cherry], summary: 'Get MCP Server', description: DOC_DESCRIPTIONS.get_mcp_server }
    }
  )
  // Streamable HTTP proxy. Registered as explicit methods rather than `.all()` so
  // `toOpenAPISchema` sees ordinary operations; only POST carries traffic, so the two
  // 405 responders stay out of the docs.
  .post('/:server_id/mcp', ({ params, request, body }) => handleMcpRequest(params.server_id, request, body), {
    params: ServerIdParamSchema,
    detail: { tags: [DOC_TAGS.cherry], summary: 'MCP Proxy', description: DOC_DESCRIPTIONS.mcp_proxy }
  })
  // Stateless means no standalone SSE stream and no session to terminate, and the spec's
  // answer in both cases is 405. Handled here rather than by the transport: its GET branch
  // ignores stateless mode and opens an SSE stream that this request's own teardown would
  // close immediately, handing the client a dead stream instead of an honest refusal.
  .get('/:server_id/mcp', () => methodNotAllowed(), { params: ServerIdParamSchema, detail: { hide: true } })
  .delete('/:server_id/mcp', () => methodNotAllowed(), { params: ServerIdParamSchema, detail: { hide: true } })

/** The MCP SDK's own 405 body, so clients see one shape whoever produced it. */
function methodNotAllowed(): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }),
    {
      status: 405,
      headers: { Allow: 'POST', 'Content-Type': 'application/json' }
    }
  )
}

async function handleMcpRequest(serverId: string, request: Request, body?: unknown): Promise<Response> {
  const server = resolveServer(serverId)
  await application.get('McpCatalogService').warmToolsCache(server.id)

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  })
  const bridge = createMcpBridgeServer(server.id, server)
  await bridge.connect(transport)

  try {
    // Elysia has already consumed the body stream, so hand the parsed value over
    // rather than letting the transport re-read `request.json()`.
    return await transport.handleRequest(request, body === undefined ? undefined : { parsedBody: body })
  } finally {
    // `handleRequest` resolves only once the JSON response is fully built
    // (`enableJsonResponse`), so tearing down here cannot truncate it.
    await bridge.close().catch((error) => logger.warn('Failed to close MCP bridge', { serverId: server.id, error }))
  }
}
