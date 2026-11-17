import { type CallToolResult, McpServer } from '@modelcontextprotocol/server'
import { net } from 'electron'
import * as z from 'zod'

// inspired by https://dify.ai/blog/turn-your-dify-app-into-an-mcp-server
import { loggerService } from '@logger'

const logger = loggerService.withContext('DifyKnowledgeServer')

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

export function createDifyKnowledgeServer(difyKey: string, args: string[]): McpServer {
  if (args.length === 0) throw new Error('DifyKnowledgeServer requires at least one argument')
  const apiHost = args[0]
  const server = new McpServer({ name: '@cherry/dify-knowledge-server', version: '0.1.0' })

  server.registerTool('list_knowledges', { description: 'List all knowledges' }, () =>
    performListKnowledges(difyKey, apiHost)
  )
  server.registerTool(
    'search_knowledge',
    { description: 'Search knowledge by id and query', inputSchema: SearchKnowledgeArgsSchema },
    ({ id, query, topK }) => performSearchKnowledge(id, query, topK ?? 6, difyKey, apiHost)
  )
  return server
}

async function performListKnowledges(difyKey: string, apiHost: string): Promise<CallToolResult> {
  try {
    const url = `${apiHost.replace(/\/$/, '')}/datasets`
    const response = await net.fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${difyKey}`
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API request failed, status code ${response.status}: ${errorText}`)
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

    const formattedText = `### Available Knowledge Bases:\n\n${listText}`

    return {
      content: [{ type: 'text', text: formattedText }]
    }
  } catch (error) {
    logger.error('Error fetching knowledge list:', error as Error)
    throw error
  }
}

async function performSearchKnowledge(
  id: string,
  query: string,
  topK: number,
  difyKey: string,
  apiHost: string
): Promise<CallToolResult> {
  try {
    const url = `${apiHost.replace(/\/$/, '')}/datasets/${id}/retrieve`

    const response = await net.fetch(url, {
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
          search_method: 'semantic_search',
          reranking_enable: false,
          score_threshold_enabled: false
        }
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API request failed, status code ${response.status}: ${errorText}`)
    }

    const searchResponse: DifySearchKnowledgeResponse = await response.json()

    if (!searchResponse || !Array.isArray(searchResponse.records)) {
      throw new Error(`Invalid response format from Dify API: ${JSON.stringify(searchResponse)}`)
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
    throw error
  }
}
