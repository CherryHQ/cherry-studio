import { loggerService } from '@logger'
import { webSearchService } from '@main/services/WebSearchService'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListToolsResult,
  McpError
} from '@modelcontextprotocol/sdk/types.js'

const logger = loggerService.withContext('WebSearchMCP')

export class WebSearchServer {
  public server: Server

  constructor() {
    this.server = new Server(
      { name: '@cherry/web-search', version: '1.0.0' },
      {
        capabilities: {
          tools: {}
        }
      }
    )
    this.setupToolHandlers()
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: ListToolsResult = {
        tools: [
          {
            name: 'web_search',
            description: "Perform web search using Cherry Studio's built-in web search providers",
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query'
                }
              },
              required: ['query']
            }
          }
        ]
      }
      return tools
    })

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params

      if (name !== 'web_search') {
        throw new McpError(ErrorCode.MethodNotFound, `Tool ${name} not found`)
      }

      try {
        const { query } = args as {
          query: string
        }

        logger.debug(`Web search requested: ${query}`)

        const result = await webSearchService.executeSearch(query)

        if (!result.success) {
          throw new McpError(ErrorCode.InternalError, result.error || 'Web search failed')
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                query: result.query,
                results: result.results
              })
            }
          ]
        }
      } catch (error) {
        logger.error('Web search failed:', error as Error)
        throw new McpError(ErrorCode.InternalError, `Web search failed: ${(error as Error).message}`)
      }
    })
  }
}

export default WebSearchServer
