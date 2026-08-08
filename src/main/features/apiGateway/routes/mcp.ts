import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { createMcpBridgeServer } from '@main/ai/mcp/createMcpBridgeServer'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { McpServer } from '@shared/data/types/mcpServer'
import { Elysia } from 'elysia'
import * as z from 'zod'

import { type McpSessionStore, SessionLimitReachedError } from '../mcpSessionStore'
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
 * Sessions are **opt-in by the client** (see `handleProxyPost`): a client that sends
 * `initialize` gets an `Mcp-Session-Id` and may hold a `GET` stream for server→client
 * push; one that just POSTs a method — the shape plain `curl` and the v1 endpoints
 * allow — keeps the one-shot stateless path, where a fresh bridge serves the request
 * and is torn down with it. Both warm the tools cache first, because the bridge's
 * `tools/list` reads cache-only.
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
          detail: { tags: [DOC_TAGS.cherry], summary: 'Get MCP Server', description: DOC_DESCRIPTIONS.get_mcp_server }
        }
      )
      // Streamable HTTP proxy. Registered as explicit methods rather than `.all()` so
      // `toOpenAPISchema` sees ordinary operations; GET/DELETE only serve existing sessions,
      // so they stay out of the docs.
      .post(
        '/:server_id/mcp',
        ({ params, request, body }) => handleProxyPost(sessions, params.server_id, request, body),
        {
          params: ServerIdParamSchema,
          detail: { tags: [DOC_TAGS.cherry], summary: 'MCP Proxy', description: DOC_DESCRIPTIONS.mcp_proxy }
        }
      )
      // Opens the standalone SSE stream that carries server→client push (`tools/list_changed`).
      // Only meaningful for a session: without one there is nothing to push through, and letting
      // the transport handle it would open a stream that the request's own teardown closes,
      // handing the client a dead stream instead of an honest refusal.
      .get('/:server_id/mcp', ({ params, request }) => handleProxySessionOnly(sessions, params.server_id, request), {
        params: ServerIdParamSchema,
        detail: { hide: true }
      })
      // Session termination. Sessionless clients have nothing to terminate → 405, per spec.
      .delete('/:server_id/mcp', ({ params, request }) => handleProxySessionOnly(sessions, params.server_id, request), {
        params: ServerIdParamSchema,
        detail: { hide: true }
      })
  )
}

/** The MCP SDK's own 405 body, so clients see one shape whoever produced it. */
function methodNotAllowed(): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }),
    { status: 405, headers: { Allow: 'POST, GET, DELETE', 'Content-Type': 'application/json' } }
  )
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

async function handleProxyPost(
  sessions: McpSessionStore,
  serverIdOrName: string,
  request: Request,
  body?: unknown
): Promise<Response> {
  const server = resolveServer(serverIdOrName)
  await application.get('McpCatalogService').warmToolsCache(server.id)

  const session = lookupSession(sessions, request, server.id)
  if (session === null) return sessionNotFound()
  // Elysia has already consumed the body stream, so every path below hands the parsed
  // value over rather than letting the transport re-read `request.json()`.
  if (session) return session.transport.handleRequest(request, { parsedBody: body })

  if (isInitialize(body)) {
    try {
      return await sessions.createAndHandle(server, request, body)
    } catch (error) {
      if (error instanceof SessionLimitReachedError) {
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
  return session.transport.handleRequest(request)
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
  const bridge = createMcpBridgeServer(server.id, server)
  await bridge.connect(transport)

  try {
    return await transport.handleRequest(request, body === undefined ? undefined : { parsedBody: body })
  } finally {
    // `handleRequest` resolves only once the JSON response is fully built
    // (`enableJsonResponse`), so tearing down here cannot truncate it.
    await bridge.close().catch((error) => logger.warn('Failed to close MCP bridge', { serverId: server.id, error }))
  }
}
