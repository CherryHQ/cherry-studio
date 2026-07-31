import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { Elysia } from 'elysia'
import * as z from 'zod'

import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { createMcpBridgeServer } from '@main/ai/mcp/createMcpBridgeServer'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { McpServer } from '@shared/data/types/mcpServer'

import { jsonRpcEnvelope, MCP_TRANSPORT_ERROR } from '../errors'
import { type McpSessionStore, SessionLimitReachedError, StoreClosedError } from '../McpSessionStore'
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
/** The SSE framing a session request answers with; each `data:` line is a JSON-RPC message. */
const SSE_RESPONSE_DOC = {
  type: 'string',
  description:
    'Server-sent event stream. Each event carries one JSON-RPC message in `data:` — zero or more notifications, then the response.',
  example: 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n'
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
 * Sessions are **opt-in by the client** (see `handleProxyPost`): one that sends `initialize`
 * gets an `Mcp-Session-Id` and may hold a `GET` stream for server→client push; one that just
 * POSTs a method — the shape plain `curl` and the v1 endpoints allow — keeps the one-shot
 * path, where a fresh bridge serves the request and is torn down with it.
 *
 * The two paths differ where the transport genuinely differs, never cosmetically:
 * - **Capability.** Sessions build the bridge with `listChanged: true` because they can
 *   deliver the notification; the one-shot path passes `false` so a client is never told to
 *   expect a heal that cannot arrive, and re-lists instead.
 * - **Response encoding.** Session POSTs answer in SSE, the one-shot path in JSON: the SDK
 *   only writes request-related notifications (a tool's `notifications/progress`) when JSON
 *   response mode is off. The one-shot path has no stream for them either way.
 * - **Cancellation.** Within a session `notifications/cancelled` reaches the bridge that owns
 *   the running request. One-shot cannot — the notification lands on a *different* bridge and
 *   the SDK keeps abort controllers per `Server` instance. Both forward `extra.signal` into
 *   the runtime, so a dropped connection stops the upstream call regardless.
 *
 * Only `tools/list` waits on the tools cache (see `needsWarmTools`); gating the handshake on
 * an upstream probe is what times clients out.
 *
 * Session POSTs answer in SSE, the one-shot path in JSON: the SDK only writes
 * request-related notifications (a tool's `notifications/progress`) when JSON response
 * mode is off, so a session using it would resolve the call and drop every progress
 * update. The one-shot path has no stream to deliver them on either way.
 *
 * `detail.tags`/`summary` hold i18n *keys*, not translated text — see chat.ts.
 */
export function createMcpRoutes(sessions: McpSessionStore) {
  return (
    new Elysia({ prefix: '/mcps' })
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
          detail: {
            tags: [DOC_TAGS.cherry],
            summary: 'List MCP Servers',
            description: DOC_DESCRIPTIONS.list_mcp_servers
          }
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
        ({ params, request, body }) =>
          forbiddenOrigin(request) ?? handleProxyPost(sessions, params.server_id, request, body),
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
                description:
                  'JSON-RPC response. A session request — one carrying `Mcp-Session-Id`, and the `initialize` that opens one — answers as `text/event-stream`, so notifications tied to the request (a tool call’s `notifications/progress`) can precede its result. The sessionless one-shot path answers as `application/json`.',
                content: {
                  'application/json': { schema: JSON_RPC_RESPONSE_DOC },
                  'text/event-stream': { schema: SSE_RESPONSE_DOC }
                }
              },
              403: { description: 'Origin is not local' },
              404: { description: 'MCP server not found, or unknown Mcp-Session-Id' },
              405: { description: 'Method not allowed on this endpoint' },
              503: { description: 'Too many live sessions, or the gateway is shutting down' }
            }
          }
        }
      )
      // Opens the standalone SSE stream that carries server→client push. Only meaningful for a
      // session: without one there is nothing to push through, and letting the transport handle
      // it would open a stream that this request's own teardown closes, handing the client a
      // dead stream instead of an honest refusal.
      .get(
        '/:server_id/mcp',
        ({ params, request }) =>
          forbiddenOrigin(request) ?? handleProxySessionOnly(sessions, params.server_id, request),
        { params: ServerIdParamSchema, detail: { hide: true } }
      )
      // Session termination. Sessionless clients have nothing to terminate → 405, per spec.
      .delete(
        '/:server_id/mcp',
        ({ params, request }) =>
          forbiddenOrigin(request) ?? handleProxySessionOnly(sessions, params.server_id, request),
        { params: ServerIdParamSchema, detail: { hide: true } }
      )
  )
}

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
  return new Response(JSON.stringify(jsonRpcEnvelope(MCP_TRANSPORT_ERROR, 'Forbidden: invalid Origin')), {
    status: 403,
    headers: { 'Content-Type': 'application/json' }
  })
}

/** The MCP SDK's own 405 body, so clients see one shape whoever produced it. */
function methodNotAllowed(): Response {
  // GET/DELETE are allowed once sessions are on, so the header lists them even when this
  // stateless refusal is what the request got.
  return new Response(JSON.stringify(jsonRpcEnvelope(MCP_TRANSPORT_ERROR, 'Method not allowed.')), {
    status: 405,
    headers: { Allow: 'POST, GET, DELETE', 'Content-Type': 'application/json' }
  })
}

/** Spec response for an `Mcp-Session-Id` the server doesn't know (expired, swept, or wrong server). */
function sessionNotFound(): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null }),
    { status: 404, headers: { 'Content-Type': 'application/json' } }
  )
}

/** `initialize` is what opts a client into a session — including inside a JSON-RPC batch. */
function isInitialize(body: unknown): boolean {
  return Array.isArray(body) ? body.some(isInitializeRequest) : isInitializeRequest(body)
}

/**
 * Resolve a session referenced by header, rejecting one that belongs to a different MCP
 * server so a leaked id can't be replayed across servers.
 */
function lookupSession(sessions: McpSessionStore, request: Request, serverId: string) {
  const sessionId = request.headers.get('mcp-session-id')
  if (!sessionId) return undefined
  const session = sessions.get(sessionId)
  return session?.serverId === serverId ? session : null
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

async function handleProxyPost(
  sessions: McpSessionStore,
  serverIdOrName: string,
  request: Request,
  body?: unknown
): Promise<Response> {
  const server = resolveServer(serverIdOrName)
  if (needsWarmTools(body)) {
    await application.get('McpCatalogService').warmToolsCache(server.id)
  }

  const session = lookupSession(sessions, request, server.id)
  if (session === null) return sessionNotFound()
  // Elysia has already consumed the body stream, so every path below hands the parsed
  // value over rather than letting the transport re-read `request.json()`.
  if (session) return session.transport.handleRequest(request, { parsedBody: body })

  if (isInitialize(body)) {
    try {
      return await sessions.createAndHandle(server, request, body)
    } catch (error) {
      // Both mean "cannot take a new session right now", which is a retryable 503 rather
      // than a fault in the request.
      if (error instanceof SessionLimitReachedError || error instanceof StoreClosedError) {
        logger.warn('Refused MCP session', { serverId: server.id, error })
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: error.message }, id: null }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      }
      throw error
    }
  }

  return handleOneShot(server, request, body)
}

/** GET/DELETE carry no body to opt into a session, so they serve existing ones or refuse. */
async function handleProxySessionOnly(
  sessions: McpSessionStore,
  serverIdOrName: string,
  request: Request
): Promise<Response> {
  const server = resolveServer(serverIdOrName)
  const session = lookupSession(sessions, request, server.id)
  if (session === null) return sessionNotFound()
  if (!session) return methodNotAllowed()
  return primeEventStream(await session.transport.handleRequest(request))
}

/**
 * Emit one SSE comment up front so the client actually receives the response head.
 *
 * The notification stream opens silent — nothing is written until a notification happens —
 * and Node only flushes headers with the first body chunk. Without this a client's `GET`
 * hangs with no status at all, and because the transport has already registered the stream
 * its retry gets 409 "only one SSE stream per session". A comment line is inert per the SSE
 * grammar, so every client ignores it.
 */
function primeEventStream(response: Response): Response {
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) return response

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const source = response.body
  // A client that disconnects rejects the write, the pipe, or both; that is an ordinary
  // end-of-stream here, not an error anyone can act on.
  void primeAndPipe(writable, source).catch(() => {})

  return new Response(readable, { status: response.status, headers: response.headers })
}

async function primeAndPipe(writable: WritableStream<Uint8Array>, source: ReadableStream<Uint8Array>): Promise<void> {
  const writer = writable.getWriter()
  try {
    await writer.write(new TextEncoder().encode(': open\n\n'))
  } catch (error) {
    // The client vanished before the priming byte landed, so the `pipeTo` below never runs.
    // `pipeTo` is what would otherwise cancel `source`, and the SDK unregisters its standalone
    // stream from that cancel callback — skipping it strands the mapping, so every later GET
    // on this session answers 409 "only one SSE stream" until DELETE or the idle sweep.
    await source.cancel(error).catch(() => {})
    throw error
  } finally {
    writer.releaseLock()
  }
  // Past this point cancellation is `pipeTo`'s job: a destination error cancels the source,
  // since `preventCancel` defaults to false.
  await source.pipeTo(writable)
}

/**
 * Sessionless path: a throwaway bridge serves this one request. Kept for clients that POST a
 * method without an `initialize` handshake — the shape plain `curl` and the v1 endpoints allow.
 */
async function handleOneShot(server: McpServer, request: Request, body?: unknown): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  })
  // No stream to push on, so the bridge must not advertise `tools.listChanged`; see
  // `McpBridgeOptions`. Clients re-list instead of waiting for a notification.
  const bridge = createMcpBridgeServer(server.id, server, { listChanged: false })
  await bridge.connect(transport)

  try {
    return await transport.handleRequest(request, body === undefined ? undefined : { parsedBody: body })
  } finally {
    // `handleRequest` resolves only once the JSON response is fully built
    // (`enableJsonResponse`), so tearing down here cannot truncate it.
    await bridge.close().catch((error) => logger.warn('Failed to close MCP bridge', { serverId: server.id, error }))
  }
}
