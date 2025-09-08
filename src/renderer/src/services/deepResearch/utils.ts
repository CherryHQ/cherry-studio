import { WebSearchResultBlock } from '@anthropic-ai/sdk/resources'
import type { GroundingMetadata, GroundingSupport } from '@google/genai'
import {
  KnowledgeReference,
  MCPToolResponse,
  WebSearchProviderResponse,
  WebSearchResponse,
  WebSearchSource
} from '@renderer/types'
import type OpenAI from 'openai'

type FormattedInfoSource = {
  index: number
  type: 'websearch' | 'knowledge' | 'tool'
  title?: string
  url?: string
  content?: string
}

const formatInfoSource = (s: FormattedInfoSource) => `--- SOURCE ${s.index}: ${s.title || ''} ---
${s.url ? `URL: ${s.url}` : ''}
TYPE: ${s.type}
Content:
${s.content || ''}
--- END SOURCE ${s.index} ---
`

export const formatInfoSources = (
  rawResult: string,
  infoSources: (WebSearchResponse | KnowledgeReference | MCPToolResponse)[]
) => {
  const webSearches = infoSources.filter((s): s is WebSearchResponse => 'source' in s && 'results' in s)

  const knowledgeRefs = infoSources.filter((s): s is KnowledgeReference => 'title' in s && 'content' in s)

  const toolResponses = infoSources.filter((s): s is MCPToolResponse => 'tool' in s && 'arguments' in s)

  const searchSources = webSearches
    .map((searchSource): FormattedInfoSource[] => {
      switch (searchSource.source) {
        case WebSearchSource.GEMINI: {
          const groundingMetadata = searchSource.results as GroundingMetadata
          const contentMap = buildGeminiContentMap(rawResult, groundingMetadata.groundingSupports || [])
          return (
            groundingMetadata?.groundingChunks?.map(
              (chunk, index): FormattedInfoSource => ({
                index: index + 1,
                type: 'websearch',
                title: chunk?.web?.title || '',
                url: chunk?.web?.uri || '',
                content: contentMap[index] ? contentMap[index].join('\n') : ''
              })
            ) || []
          )
        }
        case WebSearchSource.OPENAI_RESPONSE:
          return (
            (searchSource.results as OpenAI.Responses.ResponseOutputText.URLCitation[])?.map((result, index) => {
              return {
                index: index + 1,
                type: 'websearch',
                url: result.url,
                title: result.title
              }
            }) || []
          )

        case WebSearchSource.OPENAI:
          return (
            (searchSource.results as OpenAI.Chat.Completions.ChatCompletionMessage.Annotation[])?.map(
              (annotation, index) => {
                const urlCitation = annotation.url_citation
                return {
                  index: index + 1,
                  type: 'websearch',
                  url: urlCitation.url,
                  title: urlCitation.title
                }
              }
            ) || []
          )
        case WebSearchSource.ANTHROPIC:
          return (
            (searchSource.results as Array<WebSearchResultBlock>)?.map((result, index) => {
              const { url } = result
              return {
                index: index + 1,
                url: url,
                title: result.title,
                type: 'websearch'
              }
            }) || []
          )
        case WebSearchSource.PERPLEXITY: {
          return (
            (searchSource.results as any[])?.map((result, index) => ({
              index: index + 1,
              url: result.url || result, // 兼容旧数据
              title: result.title || new URL(result).hostname, // 兼容旧数据
              type: 'websearch'
            })) || []
          )
        }
        case WebSearchSource.GROK:
        case WebSearchSource.OPENROUTER:
          return (
            (searchSource.results as any[])?.map((url, index) => ({
              index: index + 1,
              url: url,
              type: 'websearch'
            })) || []
          )
        case WebSearchSource.ZHIPU:
        case WebSearchSource.HUNYUAN:
          return (
            (searchSource.results as any[])?.map((result, index) => ({
              index: index + 1,
              url: result.link || result.url,
              title: result.title,
              type: 'websearch'
            })) || []
          )
        case WebSearchSource.WEBSEARCH:
          return (
            (searchSource.results as WebSearchProviderResponse)?.results?.map((result, index) => ({
              index: index + 1,
              type: 'websearch',
              url: result.url,
              title: result.title,
              content: result.content
            })) || []
          )
        default:
          return []
      }
    })
    .flat()

  const knowledgeSources: FormattedInfoSource[] = knowledgeRefs.map((knowledgeRef, index) => {
    const filePattern = /\[(.*?)]\(http:\/\/file\/(.*?)\)/
    const fileMatch = knowledgeRef.sourceUrl.match(filePattern)
    let url = knowledgeRef.sourceUrl
    let title = knowledgeRef.sourceUrl

    // 如果匹配文件链接格式 [filename](http://file/xxx)
    if (fileMatch) {
      title = fileMatch[1]
      url = `http://file/${fileMatch[2]}`
    }

    return {
      index: index + 1,
      type: 'knowledge',
      title: title,
      url: url,
      content: knowledgeRef.content
    }
  })

  const toolSources: FormattedInfoSource[] = toolResponses.map((toolResponse, index) => {
    return {
      index: index + 1,
      type: 'tool',
      content: formatToolResp(toolResponse)
    }
  })

  const combinedSources: FormattedInfoSource[] = [...searchSources, ...knowledgeSources, ...toolSources].map(
    (s, idx) => {
      return {
        ...s,
        index: idx + 1
      }
    }
  )
  return combinedSources
    .map((s: FormattedInfoSource) => {
      return formatInfoSource(s)
    })
    .join('\n')
}

const buildGeminiContentMap = (rawText: string, groundingSupports: GroundingSupport[]): Record<number, string[]> => {
  const contentMap: Record<number, string[]> = {}

  for (const support of groundingSupports) {
    if (!support.segment || !support.groundingChunkIndices) {
      continue
    }

    const snippet = rawText.slice(support.segment.startIndex, support.segment.endIndex)

    for (const chunkIndex of support.groundingChunkIndices) {
      if (!contentMap[chunkIndex]) {
        contentMap[chunkIndex] = []
      }

      contentMap[chunkIndex].push(snippet.trim())
    }
  }

  return contentMap
}

const formatToolResp = (toolResp: MCPToolResponse) => {
  const argsStr = toolResp.arguments
    ? Object.entries(toolResp.arguments)
        .map(([key, value]) => {
          const valStr = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
          return `${key}=${valStr}`
        })
        .join(' ')
    : undefined

  return `TOOL: ${toolResp.tool.name}
ARGS: ${argsStr || 'N/A'}
RESULT: ${JSON.stringify(toolResp.response) || 'N/A'}
`
}
