import {
  CLIENT_CAPABILITIES_META_KEY,
  createMcpHandler,
  Server,
  type ServerContext,
  type ResultTypeMap,
  type InputRequiredResult
} from '@modelcontextprotocol/server'

import { application } from '@application'
import { loggerService } from '@logger'
import type { McpConnection, McpForwardMethod } from '@main/ai/mcp/connections/McpConnection'
import { stripCatalogFields } from '@main/ai/mcp/createMcpBridgeServer'
import type { McpServer } from '@shared/data/types/mcpServer'

const logger = loggerService.withContext('ModernMcpProxy')

/** One SDK subscription bus per exposed server, owned and closed by the gateway's MCP store. */
export class ModernMcpProxy {
  readonly handler
  private readonly subscription
  private readonly catalogSubscription
  lastActivityAt = Date.now()

  constructor(server: McpServer) {
    this.handler = createMcpHandler(() => this.createServer(server), { legacy: 'reject', maxSubscriptions: 64 })
    this.subscription = application.get('McpCatalogService').onToolsCacheUpdated(({ serverId }) => {
      if (serverId !== server.id) return
      this.lastActivityAt = Date.now()
      this.handler.notify.toolsChanged()
    })
    this.catalogSubscription = application.get('McpRuntimeService').onCatalogChanged(({ serverId, kind }) => {
      if (serverId !== server.id) return
      if (kind === 'prompts') this.handler.notify.promptsChanged()
      else this.handler.notify.resourcesChanged()
    })
  }

  private async createServer(config: McpServer): Promise<Server> {
    const runtime = application.get('McpRuntimeService')
    // Connected servers skip the per-request liveness probe; the factory runs on every request.
    if (!runtime.getConnectedServerCapabilities(config.id)) await runtime.getServerCapabilities(config.id)
    const server = new Server(
      { name: config.name, version: '2.0.0' },
      {
        capabilities: {
          tools: { listChanged: true },
          prompts: { listChanged: true },
          resources: { listChanged: true }
        },
        instructions: application.get('McpRuntimeService').getConnectedServerInstructions(config.id)?.text
      }
    )
    server.setRequestHandler('tools/list', async () => ({
      // The route warms the catalog before tools/list, and list_changed keeps it fresh.
      tools: application.get('McpCatalogService').listTools(config.id).map(stripCatalogFields),
      ttlMs: 0,
      cacheScope: 'private'
    }))
    server.setRequestHandler('prompts/list', async () => ({
      prompts: (await application.get('McpCatalogService').listPrompts(config.id)).map(stripCatalogFields),
      ttlMs: 0,
      cacheScope: 'private'
    }))
    server.setRequestHandler('resources/list', async () => ({
      resources: (await application.get('McpCatalogService').listResources(config.id)).map(stripCatalogFields),
      ttlMs: 0,
      cacheScope: 'private'
    }))
    server.setRequestHandler('resources/templates/list', async () => ({
      resourceTemplates: (await application.get('McpCatalogService').listResourceTemplates(config.id)).map(
        stripCatalogFields
      ),
      ttlMs: 0,
      cacheScope: 'private'
    }))
    const forward = <M extends McpForwardMethod>(
      method: M,
      params: Parameters<McpConnection['forwardRequest']>[1],
      context: ServerContext
    ): Promise<ResultTypeMap[M] | InputRequiredResult> => {
      const progressToken = context.mcpReq._meta?.progressToken
      const request = { ...params }
      if (context.mcpReq.inputResponses !== undefined) request.inputResponses = context.mcpReq.inputResponses
      if (context.mcpReq.requestState() !== undefined) request.requestState = context.mcpReq.requestState()
      return application.get('McpRuntimeService').forwardRequest(config.id, method, request, {
        signal: context.mcpReq.signal,
        capabilities: context.mcpReq.envelope?.[CLIENT_CAPABILITIES_META_KEY] ?? {},
        onProgress:
          progressToken === undefined
            ? undefined
            : (progress, total) => {
                this.lastActivityAt = Date.now()
                const params = { progressToken, progress }
                if (total !== undefined) Object.assign(params, { total })
                void context.mcpReq
                  .notify({
                    method: 'notifications/progress',
                    params
                  })
                  .catch((error) => logger.debug('MCP proxy progress stream closed', { error }))
              }
      }) as Promise<ResultTypeMap[M] | InputRequiredResult>
    }
    server.setRequestHandler('tools/call', (request, context) => forward('tools/call', request.params, context))
    server.setRequestHandler('prompts/get', (request, context) => forward('prompts/get', request.params, context))
    server.setRequestHandler('resources/read', (request, context) => forward('resources/read', request.params, context))
    return server
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Elysia parses JSON but does not validate MCP; the SDK transport owns JSON-RPC validation and malformed-request responses.
  async fetch(request: Request, parsedBody?: unknown): Promise<Response> {
    this.lastActivityAt = Date.now()
    const response = await this.handler.fetch(request, { parsedBody })
    if (!response.body) return response

    const body = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, controller) => {
          this.lastActivityAt = Date.now()
          controller.enqueue(chunk)
        }
      })
    )
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  }

  async close(): Promise<void> {
    this.subscription.dispose()
    this.catalogSubscription.dispose()
    await this.handler.close()
  }
}
