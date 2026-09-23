import {
  CLIENT_CAPABILITIES_META_KEY,
  type Tool,
  createMcpHandler,
  Server,
  type ServerContext,
  type ResultTypeMap,
  type InputRequiredResult
} from '@modelcontextprotocol/server'

import { application } from '@application'
import { loggerService } from '@logger'
import type { McpForwardMethod } from '@main/ai/mcp/connections/McpConnection'
import type { McpServer } from '@shared/data/types/mcpServer'

const logger = loggerService.withContext('ModernMcpProxy')

/** One SDK subscription bus per exposed server, owned and closed by the gateway's MCP store. */
export class ModernMcpProxy {
  readonly handler
  private readonly subscription
  lastActivityAt = Date.now()

  constructor(server: McpServer) {
    this.handler = createMcpHandler(() => this.createServer(server), { legacy: 'reject', maxSubscriptions: 64 })
    this.subscription = application.get('McpCatalogService').onToolsCacheUpdated(({ serverId }) => {
      if (serverId !== server.id) return
      this.lastActivityAt = Date.now()
      this.handler.notify.toolsChanged()
    })
  }

  private createServer(config: McpServer): Server {
    const server = new Server(
      { name: config.name, version: '2.0.0' },
      {
        capabilities: { tools: { listChanged: true }, prompts: {}, resources: {} }
      }
    )
    server.setRequestHandler('tools/list', async () => ({
      tools: application
        .get('McpCatalogService')
        .listTools(config.id, { includeDisabled: false })
        .map(stripCatalogMetadata) as Tool[]
    }))
    server.setRequestHandler('prompts/list', async () => ({
      prompts: (await application.get('McpCatalogService').listPrompts(config.id)).map(stripCatalogMetadata)
    }))
    server.setRequestHandler('resources/list', async () => ({
      resources: (await application.get('McpCatalogService').listResources(config.id)).map(stripCatalogMetadata)
    }))

    const forward = <M extends McpForwardMethod>(
      method: M,
      params: Record<string, unknown>,
      context: ServerContext
    ): Promise<ResultTypeMap[M] | InputRequiredResult> => {
      const progressToken = context.mcpReq._meta?.progressToken
      return application.get('McpRuntimeService').forwardRequest(
        config.id,
        method,
        {
          ...params,
          ...(context.mcpReq.inputResponses === undefined ? {} : { inputResponses: context.mcpReq.inputResponses }),
          ...(context.mcpReq.requestState() === undefined ? {} : { requestState: context.mcpReq.requestState() })
        },
        {
          signal: context.mcpReq.signal,
          capabilities: context.mcpReq.envelope?.[CLIENT_CAPABILITIES_META_KEY] ?? {},
          onProgress:
            progressToken === undefined
              ? undefined
              : (progress, total) => {
                  this.lastActivityAt = Date.now()
                  void context.mcpReq
                    .notify({
                      method: 'notifications/progress',
                      params: { progressToken, progress, ...(total === undefined ? {} : { total }) }
                    })
                    .catch((error) => logger.debug('MCP proxy progress stream closed', { error }))
                }
        }
      ) as Promise<ResultTypeMap[M] | InputRequiredResult>
    }
    server.setRequestHandler('tools/call', (request, context) => forward('tools/call', request.params, context))
    server.setRequestHandler('prompts/get', (request, context) => forward('prompts/get', request.params, context))
    server.setRequestHandler('resources/read', (request, context) => forward('resources/read', request.params, context))
    return server
  }

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
    await this.handler.close()
  }
}

function stripCatalogMetadata<T extends object>(item: T): T {
  const copy = { ...item }
  for (const key of ['id', 'serverId', 'serverName', 'type']) Reflect.deleteProperty(copy, key)
  return copy
}
