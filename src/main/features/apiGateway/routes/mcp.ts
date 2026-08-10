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

const McpServerSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal('streamableHttp'),
  description: z.string().optional(),
  /** Absolute URL to point an MCP client at. */
  url: z.string()
})
const ListMcpServersResponseSchema = z.object({ servers: z.array(McpServerSummarySchema) })

/**
 * Documentation-only, unlike the list endpoint's `response` schema: tools are passed through
 * verbatim from the upstream server, and a validating schema here would silently strip
 * whatever fields it did not anticipate.
 */
const MCP_SERVER_DETAIL_DOC = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string', description: 'Upstream transport, e.g. stdio' },
    description: { type: 'string' },
    tools: {
      type: 'array',
      items: {
        type: 'object',
        description: 'Passed through from the upstream server; extra fields are preserved',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          inputSchema: { type: 'object' }
        }
      }
    }
  }
} as const

/**
 * Hand-written OpenAPI fragments for the proxy. The JSON-RPC envelope is polymorphic
 * (any `method`, any `result`), so pinning it with a validating schema would reject
 * traffic the transport must be free to interpret — these describe it without enforcing it.
 */
const JSON_RPC_REQUEST_DOC = {
  type: 'object',
  properties: {
    jsonrpc: { type: 'string', description: 'Always "2.0"' },
    id: { type: 'string', description: 'String or number; omitted entirely for notifications' },
    method: { type: 'string', description: 'e.g. initialize, tools/list, tools/call' },
    params: { type: 'object' }
  },
  example: { jsonrpc: '2.0', id: 1, method: 'tools/list' }
} as const
const JSON_RPC_RESPONSE_DOC = {
  type: 'object',
  properties: {
    jsonrpc: { type: 'string', description: 'Always "2.0"' },
    id: { type: 'string', description: 'Echoes the request id; null for protocol-level errors' },
    result: { type: 'object', description: 'Present on success' },
    error: {
      type: 'object',
      description: 'Present on failure',
      properties: { code: { type: 'number' }, message: { type: 'string' } }
    }
  }
} as const

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
 * session map v1 never evicted.
 *
 * What statelessness costs, and how each cost is handled honestly rather than papered over:
 * - No server→client push. `GET` returns 405 and the bridge is built with
 *   `listChanged: false`, so the client is never told to expect a `tools/list_changed`
 *   it cannot receive; it re-lists instead.
 * - No cross-request cancellation. `notifications/cancelled` arrives on a *different*
 *   bridge than the in-flight `tools/call`, and the SDK keeps abort controllers per
 *   `Server` instance, so it cannot reach the running request. What does work is
 *   request-scoped abort: the call-tool handler forwards `extra.signal` into the runtime,
 *   so a dropped connection or transport-level abort stops the upstream call.
 * - Only `tools/list` waits on the tools cache (see `needsWarmTools`).
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
      response: { 200: ListMcpServersResponseSchema },
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
      detail: {
        tags: [DOC_TAGS.cherry],
        summary: 'Get MCP Server',
        description: DOC_DESCRIPTIONS.get_mcp_server,
        responses: {
          200: {
            description: 'MCP server with its tools',
            content: { 'application/json': { schema: MCP_SERVER_DETAIL_DOC } }
          },
          404: { description: 'MCP server not found' }
        }
      }
    }
  )
  // Streamable HTTP proxy. Registered as explicit methods rather than `.all()` so
  // `toOpenAPISchema` sees ordinary operations; only POST carries traffic, so the two
  // 405 responders stay out of the docs.
  .post(
    '/:server_id/mcp',
    ({ params, request, body }) => forbiddenOrigin(request) ?? handleMcpRequest(params.server_id, request, body),
    {
      params: ServerIdParamSchema,
      detail: {
        tags: [DOC_TAGS.cherry],
        summary: 'MCP Proxy',
        description: DOC_DESCRIPTIONS.mcp_proxy,
        // Documentation-only: the body stays untyped by Elysia so the raw JSON-RPC payload
        // reaches the transport's own parser untouched.
        requestBody: {
          required: true,
          content: { 'application/json': { schema: JSON_RPC_REQUEST_DOC } }
        },
        responses: {
          200: {
            description: 'JSON-RPC response',
            content: { 'application/json': { schema: JSON_RPC_RESPONSE_DOC } }
          },
          403: { description: 'Origin is not local' },
          404: { description: 'MCP server not found' },
          405: { description: 'Method not allowed on this endpoint' }
        }
      }
    }
  )
  // Stateless means no standalone SSE stream and no session to terminate, and the spec's
  // answer in both cases is 405. Handled here rather than by the transport: its GET branch
  // ignores stateless mode and opens an SSE stream that this request's own teardown would
  // close immediately, handing the client a dead stream instead of an honest refusal.
  .get('/:server_id/mcp', ({ request }) => forbiddenOrigin(request) ?? methodNotAllowed(), {
    params: ServerIdParamSchema,
    detail: { hide: true }
  })
  .delete('/:server_id/mcp', ({ request }) => forbiddenOrigin(request) ?? methodNotAllowed(), {
    params: ServerIdParamSchema,
    detail: { hide: true }
  })

/**
 * Reject a browser `Origin` the MCP transport spec does not consider local.
 *
 * The spec requires servers to validate `Origin` on every MCP connection to stop DNS
 * rebinding: an attacker page resolves a name to 127.0.0.1 and drives this endpoint from
 * the victim's browser. The API key is not sufficient on its own — the gateway reflects
 * arbitrary origins for its other dialects, so a browser that already carries gateway
 * credentials would send them here.
 *
 * Native clients send no `Origin` at all and are unaffected; only browser contexts are
 * constrained, and only to loopback pages.
 * https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#security-warning
 */
function forbiddenOrigin(request: Request): Response | undefined {
  const origin = request.headers.get('origin')
  if (!origin) return undefined

  let hostname: string
  try {
    hostname = new URL(origin).hostname
  } catch {
    hostname = ''
  }
  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
  if (isLoopback) return undefined

  logger.warn('Rejected MCP request from a non-local origin', { origin })
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Forbidden: invalid Origin' }, id: null }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  )
}

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

/**
 * `tools/list` is the only method whose answer depends on the tools cache, and the bridge
 * reads that cache without blocking. Warming it for *every* message would put an upstream
 * probe — whose connect timeout has a 180-second floor — in front of `initialize`,
 * `notifications/initialized` and even malformed requests, long enough to time out the
 * client handshake over something unrelated.
 */
function needsWarmTools(body: unknown): boolean {
  const wants = (message: unknown): boolean =>
    typeof message === 'object' && message !== null && (message as { method?: unknown }).method === 'tools/list'
  return Array.isArray(body) ? body.some(wants) : wants(body)
}

async function handleMcpRequest(serverId: string, request: Request, body?: unknown): Promise<Response> {
  const server = resolveServer(serverId)
  if (needsWarmTools(body)) {
    await application.get('McpCatalogService').warmToolsCache(server.id)
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  })
  // No stream to push on, so the bridge must not advertise `tools.listChanged`; see
  // `McpBridgeOptions`. Clients re-list instead of waiting for a notification.
  const bridge = createMcpBridgeServer(server.id, server, { listChanged: false })
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
