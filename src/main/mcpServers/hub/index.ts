import { loggerService } from '@logger'
import { CacheService } from '@main/services/CacheService'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'

import { generateToolFunction } from './generator'
import { callMcpTool, clearToolMap, listAllTools, syncToolMapFromGeneratedTools } from './mcp-bridge'
import { Runtime } from './runtime'
import { searchTools } from './search'
import type { ExecInput, GeneratedTool, SearchQuery } from './types'

const logger = loggerService.withContext('MCPServer:Hub')
const TOOLS_CACHE_KEY = 'hub:tools'
const TOOLS_CACHE_TTL = 60 * 1000 // 1 minute

/**
 * Hub MCP Server - A meta-server that aggregates all active MCP servers.
 *
 * This server is NOT included in builtinMCPServers because:
 * 1. It aggregates tools from all other MCP servers, not a standalone tool provider
 * 2. It's designed for LLM "code mode" - enabling AI to discover and call tools programmatically
 * 3. It should be auto-enabled when code mode features are used, not manually installed by users
 *
 * The server exposes two tools:
 * - `search`: Find available tools by keywords, returns JS function signatures
 * - `exec`: Execute JavaScript code that calls discovered tools
 */
export class HubServer {
  public server: Server
  private runtime: Runtime

  constructor() {
    this.runtime = new Runtime()

    this.server = new Server(
      {
        name: 'hub-server',
        version: '1.0.0'
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
            name: 'search',
            description:
              'Search for available MCP tools by keywords. Use this FIRST to discover tools. Returns JavaScript async function declarations with JSDoc showing exact function names, parameters, and return types for use in `exec`.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description:
                    'Comma-separated search keywords. A tool matches if ANY keyword appears in its name, description, or server name. Example: "chrome,browser,tab" matches tools related to Chrome OR browser OR tabs.'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of tools to return (default: 10, max: 50)'
                }
              },
              required: ['query']
            }
          },
          {
            name: 'exec',
            description:
              'Execute JavaScript that calls MCP tools discovered via `search`. IMPORTANT: You MUST explicitly `return` the final value, or the result will be `undefined`.',
            inputSchema: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  description:
                    'JavaScript code to execute. The code runs inside an async context, so use `await` directly. Do NOT wrap your code in `(async () => { ... })()` - this causes double-wrapping and returns undefined. All discovered tools are async functions (call as `await ToolName(params)`). Helpers: `parallel(...promises)`, `settle(...promises)`, `console.*`. You MUST `return` the final value. Examples: `const r = await Tool({ id: "1" }); return r` or `return await Tool({ x: 1 })`'
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
          case 'search':
            return await this.handleSearch(args as unknown as SearchQuery)
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

  private async fetchTools(): Promise<GeneratedTool[]> {
    const cached = CacheService.get<GeneratedTool[]>(TOOLS_CACHE_KEY)
    if (cached) {
      logger.debug('Returning cached tools')
      syncToolMapFromGeneratedTools(cached)
      return cached
    }

    logger.debug('Fetching fresh tools')
    const allTools = await listAllTools()
    const existingNames = new Set<string>()
    const tools = allTools.map((tool) => generateToolFunction(tool, existingNames, callMcpTool))
    CacheService.set(TOOLS_CACHE_KEY, tools, TOOLS_CACHE_TTL)
    syncToolMapFromGeneratedTools(tools)
    return tools
  }

  invalidateCache(): void {
    CacheService.remove(TOOLS_CACHE_KEY)
    clearToolMap()
    logger.debug('Tools cache invalidated')
  }

  private async handleSearch(query: SearchQuery) {
    if (!query.query || typeof query.query !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'query parameter is required and must be a string')
    }

    const tools = await this.fetchTools()
    const result = searchTools(tools, query)

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    }
  }

  private async handleExec(input: ExecInput) {
    if (!input.code || typeof input.code !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'code parameter is required and must be a string')
    }

    const tools = await this.fetchTools()
    const result = await this.runtime.execute(input.code, tools)

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
}

export default HubServer
