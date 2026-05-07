import { loggerService } from '@logger'
import { CacheService } from '@main/services/CacheService'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { MCPTool } from '@types'

import { formatAsText, schemaToJSDoc } from './format'
import { formatListResultAsText, listTools } from './list'
import { callMcpTool, clearToolMap, listAllTools, syncToolMapFromHubTools, syncToolMapFromTools } from './mcp-bridge'
import { Runtime } from './runtime'
import { buildToolNameMapping, resolveToolId } from './toolname'
import type { ExecInput, HubTool, InspectInput, InvokeInput, ListInput } from './types'

const logger = loggerService.withContext('MCPServer:Hub')
const TOOLS_CACHE_KEY = 'hub:tools:v2'
const TOOLS_CACHE_TTL = 60 * 1000 // 1 minute

/**
 * Hub MCP Server - A meta-server that aggregates all active MCP servers.
 *
 * This server exposes a small set of built-in meta-tools (aligned with mcphub):
 * - `list`: list/search available tools (by keyword)
 * - `inspect`: get a JSDoc stub for a single tool
 * - `invoke`: call a single tool
 * - `exec`: execute JavaScript to orchestrate multiple tool calls via `mcp.callTool()`
 */
export class HubServer {
  public server: Server
  private runtime: Runtime

  constructor() {
    this.runtime = new Runtime()

    this.server = new Server(
      {
        name: 'hub-server',
        version: '2.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )

    this.setupRequestHandlers()
  }

  private setupRequestHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'list',
            description: 'List available MCP tools from all active servers. Results are paginated via limit/offset.',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Optional maximum results to return (default: 30, max: 100).'
                },
                offset: {
                  type: 'number',
                  description: 'Optional zero-based offset for pagination (default: 0).'
                }
              }
            }
          },
          {
            name: 'inspect',
            description: "Get a single tool's signature as a JSDoc stub. Use this before `invoke` or `exec`.",
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Tool name in JS form (camelCase) OR original namespaced id (serverId__toolName).'
                }
              },
              required: ['name']
            }
          },
          {
            name: 'invoke',
            description: 'Call a single tool with parameters. Prefer `inspect` first to confirm parameters.',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Tool name in JS form (camelCase) OR original namespaced id (serverId__toolName).'
                },
                params: {
                  type: 'object',
                  description: 'Tool parameters as a JSON object (optional).'
                }
              },
              required: ['name']
            }
          },
          {
            name: 'exec',
            description:
              'Execute JavaScript code to orchestrate multiple tool calls. Use `mcp.callTool(name, params)` inside the code. IMPORTANT: you MUST explicitly `return` the final value.',
            inputSchema: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  description:
                    'JavaScript code to execute. Available globals: `mcp.callTool(name, params)`, `mcp.log(level, message, fields?)`, `parallel(...)`, `settle(...)`, `console.*`. The code runs inside an async context so you can use `await` directly. You MUST `return` the final value.'
                }
              },
              required: ['code']
            }
          }
        ]
      }
    })

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params

      if (!args) {
        throw new McpError(ErrorCode.InvalidParams, 'No arguments provided')
      }

      try {
        switch (name) {
          case 'list':
            return await this.handleList(args as unknown as ListInput)
          case 'inspect':
            return await this.handleInspect(args as unknown as InspectInput)
          case 'invoke':
            return await this.handleInvoke(args as unknown as InvokeInput)
          case 'exec':
            return await this.handleExec(args as unknown as ExecInput)
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error
        }
        logger.error(`Error executing tool ${name}:`, error as Error)
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing tool ${name}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    })
  }

  private async fetchTools(): Promise<HubTool[]> {
    const cached = CacheService.get<HubTool[]>(TOOLS_CACHE_KEY)
    if (cached) {
      logger.debug('Returning cached tools')
      syncToolMapFromHubTools(cached)
      return cached
    }

    logger.debug('Fetching fresh tools')
    const tools = await listAllTools()
    const hubTools = this.toHubTools(tools)

    CacheService.set(TOOLS_CACHE_KEY, hubTools, TOOLS_CACHE_TTL)
    syncToolMapFromTools(tools)

    return hubTools
  }

  private toHubTools(tools: MCPTool[]): HubTool[] {
    const mapping = buildToolNameMapping(
      tools.map((tool) => ({
        id: `${tool.serverId}__${tool.name}`,
        serverName: tool.serverName,
        toolName: tool.name
      }))
    )

    return tools
      .map((tool) => {
        const id = `${tool.serverId}__${tool.name}`
        return {
          id,
          serverId: tool.serverId,
          serverName: tool.serverName,
          toolName: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          jsName: mapping.toJs.get(id) ?? id
        } satisfies HubTool
      })
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  invalidateCache(): void {
    CacheService.remove(TOOLS_CACHE_KEY)
    clearToolMap()
    logger.debug('Tools cache invalidated')
  }

  private async handleList(input: ListInput) {
    const tools = await this.fetchTools()
    const result = listTools(tools, input)
    const output = formatListResultAsText(result)

    return {
      content: [
        {
          type: 'text',
          text: output
        }
      ]
    }
  }

  private async handleInspect(input: InspectInput) {
    if (!input.name || typeof input.name !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'name parameter is required and must be a string')
    }

    const tools = await this.fetchTools()
    const tool = this.resolveHubTool(tools, input.name)

    const jsDoc = schemaToJSDoc(tool.jsName, tool.description, tool.inputSchema)

    return {
      content: [
        {
          type: 'text',
          text: jsDoc
        }
      ]
    }
  }

  private async handleInvoke(input: InvokeInput) {
    if (!input.name || typeof input.name !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'name parameter is required and must be a string')
    }

    // Ensure mapping is warm
    await this.fetchTools()

    const result = await callMcpTool(input.name, input.params ?? {})

    return {
      content: [
        {
          type: 'text',
          text: formatAsText(result)
        }
      ]
    }
  }

  private async handleExec(input: ExecInput) {
    if (!input.code || typeof input.code !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'code parameter is required and must be a string')
    }

    // Ensure mapping is warm
    await this.fetchTools()

    const result = await this.runtime.execute(input.code)

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ],
      isError: result.isError
    }
  }

  private resolveHubTool(tools: HubTool[], nameOrId: string): HubTool {
    // Resolve via cached mapping first (supports both jsName and namespaced id)
    const mapping = buildToolNameMapping(
      tools.map((t) => ({ id: t.id, serverName: t.serverName, toolName: t.toolName }))
    )
    const resolvedId = resolveToolId(mapping, nameOrId) ?? nameOrId

    const found = tools.find((t) => t.id === resolvedId) ?? tools.find((t) => t.jsName === nameOrId)

    if (!found) {
      throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${nameOrId}`)
    }

    return found
  }
}

export default HubServer
