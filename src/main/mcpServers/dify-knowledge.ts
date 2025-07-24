// inspired by https://dify.ai/blog/turn-your-dify-app-into-an-mcp-server
import { loggerService } from '@logger'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod/v4'

const logger = loggerService.withContext('DifyKnowledgeServer')

interface DifyKnowledgeServerConfig {
  difyKey: string
  apiHost: string
}

interface DifyListKnowledgeResponse {
  id: string
  name: string
  description: string
}

interface DifySearchKnowledgeResponse {
  query: {
    content: string
  }
  records: Array<{
    segment: {
      id: string
      position: number
      document_id: string
      content: string
      keywords: string[]
      document?: {
        id: string
        data_source_type: string
        name: string
      }
    }
    score: number
  }>
}

const SearchKnowledgeArgsSchema = z.object({
  id: z.string().describe('Knowledge ID'),
  query: z.string().describe('Query string'),
  topK: z.number().optional().describe('Number of top results to return')
})

type McpResponse = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

class DifyKnowledgeServer {
  public server: Server
  private config: DifyKnowledgeServerConfig

  constructor(difyKey: string, args: string[]) {
    if (args.length === 0) {
      throw new Error('DifyKnowledgeServer requires at least one argument')
    }
    this.config = {
      difyKey: difyKey,
      apiHost: args[0]
    }
    this.server = new Server(
      {
        name: '@cherry/dify-knowledge-server',
        version: '0.1.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )
    this.initialize()
  }

  initialize() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'list_knowledges',
            description: 'List all knowledges',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'search_knowledge',
            description: 'Search knowledge by id and query',
            inputSchema: z.toJSONSchema(SearchKnowledgeArgsSchema)
          }
        ]
      }
    })

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params
        switch (name) {
          case 'list_knowledges': {
            return await this.performListKnowledges(this.config.difyKey, this.config.apiHost)
          }
          case 'search_knowledge': {
            const parsed = SearchKnowledgeArgsSchema.safeParse(args)
            if (!parsed.success) {
              const errorDetails = JSON.stringify(parsed.error.format(), null, 2)
              throw new Error(`无效的参数:\n${errorDetails}`)
            }
            return await this.performSearchKnowledge(
              parsed.data.id,
              parsed.data.query,
              parsed.data.topK || 6,
              this.config.difyKey,
              this.config.apiHost
            )
          }
          default:
            throw new Error(`Unknown tool: ${name}`)
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text', text: `Error: ${errorMessage}` }],
          isError: true
        }
      }
    })
  }

  private async performListKnowledges(difyKey: string, apiHost: string): Promise<McpResponse> {
    try {
      const url = `${apiHost.replace(/\/$/, '')}/datasets`
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${difyKey}`
        }
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API 请求失败，状态码 ${response.status}: ${errorText}`)
      }

      const apiResponse = await response.json()

      const knowledges: DifyListKnowledgeResponse[] =
        apiResponse?.data?.map((item: any) => ({
          id: item.id,
          name: item.name,
          description: item.description || ''
        })) || []

      const listText =
        knowledges.length > 0
          ? knowledges.map((k) => `- **${k.name}** (ID: ${k.id})\n  ${k.description || 'No Description'}`).join('\n')
          : '- No knowledges found.'

      const formattedText = `### 可用知识库:\n\n${listText}`

      return {
        content: [{ type: 'text', text: formattedText }]
      }
    } catch (error) {
      logger.error('Error fetching knowledge list:', error as Error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      // 返回包含错误信息的 MCP 响应
      return {
        content: [{ type: 'text', text: `Accessing Knowledge Error: ${errorMessage}` }],
        isError: true
      }
    }
  }

  private async performSearchKnowledge(
    id: string,
    query: string,
    topK: number,
    difyKey: string,
    apiHost: string
  ): Promise<McpResponse> {
    try {
      const url = `${apiHost.replace(/\/$/, '')}/datasets/${id}/retrieve`

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${difyKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: query,
          retrieval_model: {
            top_k: topK,
            // will be error if not set
            reranking_enable: null,
            score_threshold_enabled: null
          }
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API 请求失败，状态码 ${response.status}: ${errorText}`)
      }

      const searchResponse: DifySearchKnowledgeResponse = await response.json()

      if (!searchResponse || !Array.isArray(searchResponse.records)) {
        throw new Error(`从 Dify API 收到的响应格式无效: ${JSON.stringify(searchResponse)}`)
      }

      const header = `### Query: ${query}\n\n`
      let body: string

      if (searchResponse.records.length === 0) {
        body = 'No results found.'
      } else {
        const resultsText = searchResponse.records
          .map((record, index) => {
            const docName = record.segment.document?.name || 'Unknown Document'
            const content = record.segment.content.trim()
            const score = record.score
            const keywords = record.segment.keywords || []

            let resultEntry = `#### ${index + 1}. ${docName} (Relevant Score: ${(score * 100).toFixed(1)}%)`
            resultEntry += `\n${content}`
            if (keywords.length > 0) {
              resultEntry += `\n*Keywords: ${keywords.join(', ')}*`
            }
            return resultEntry
          })
          .join('\n\n')

        body = `Found ${searchResponse.records.length} results:\n\n${resultsText}`
      }

      const formattedText = header + body

      return {
        content: [{ type: 'text', text: formattedText }]
      }
    } catch (error) {
      logger.error('Error searching knowledge:', error as Error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: 'text', text: `Search Knowledge Error: ${errorMessage}` }],
        isError: true
      }
    }
  }
}

export default DifyKnowledgeServer
