import { loggerService } from '@logger'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'

import { Runtime } from './runtime'
import { searchTools } from './search'
import { ToolRegistry } from './tool-registry'
import type { ExecInput, SearchQuery } from './types'

const logger = loggerService.withContext('MCPServer:Hub')

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
  private toolRegistry: ToolRegistry
  private runtime: Runtime

  constructor() {
    this.toolRegistry = new ToolRegistry()
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
              'Search for available MCP tools by keywords. Returns JavaScript function declarations with JSDoc that can be used in the exec tool.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description:
                    'Search keywords, comma-separated for OR matching. Example: "chrome,browser" matches tools with "chrome" OR "browser"'
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
              'Execute JavaScript code that calls MCP tools. Use the search tool first to discover available tools and their signatures.',
            inputSchema: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  description:
                    'JavaScript code to execute. Can use async/await. Available helpers: parallel(...promises), settle(...promises). The last expression is returned.'
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

  private async handleSearch(query: SearchQuery) {
    if (!query.query || typeof query.query !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'query parameter is required and must be a string')
    }

    const tools = await this.toolRegistry.getTools()
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

    const tools = await this.toolRegistry.getTools()
    const result = await this.runtime.execute(input.code, tools)

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    }
  }

  invalidateCache(): void {
    this.toolRegistry.invalidate()
  }
}

export default HubServer
