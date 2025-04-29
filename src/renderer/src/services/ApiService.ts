import { getOpenAIWebSearchParams, isOpenAIWebSearch } from '@renderer/config/models'
import {
  SEARCH_SUMMARY_PROMPT,
  SEARCH_SUMMARY_PROMPT_KNOWLEDGE_ONLY,
  SEARCH_SUMMARY_PROMPT_WEB_ONLY
} from '@renderer/config/prompts'
import i18n from '@renderer/i18n'
import {
  Assistant,
  ExternalToolResult,
  KnowledgeReference,
  MCPTool,
  Model,
  Provider,
  Suggestion,
  WebSearchResponse,
  WebSearchSource
} from '@renderer/types'
import { type Chunk, ChunkType } from '@renderer/types/chunk'
import { Message } from '@renderer/types/newMessage'
import { isAbortError } from '@renderer/utils/error'
import { extractInfoFromXML, ExtractResults } from '@renderer/utils/extract'
import { getKnowledgeBaseIds, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { findLast, isEmpty } from 'lodash'

import AiProvider from '../providers/AiProvider'
import {
  getAssistantProvider,
  getDefaultModel,
  getProviderByModel,
  getTopNamingModel,
  getTranslateModel
} from './AssistantService'
import { getDefaultAssistant } from './AssistantService'
import { processKnowledgeSearch } from './KnowledgeService'
import { filterContextMessages, filterMessages, filterUsefulMessages } from './MessagesService'
import WebSearchService from './WebSearchService'

// TODO：考虑拆开
async function fetchExternalTool(
  lastUserMessage: Message,
  assistant: Assistant,
  onChunkReceived: (chunk: Chunk) => void,
  lastAnswer?: Message
): Promise<ExternalToolResult> {
  // 可能会有重复？
  const knowledgeBaseIds = getKnowledgeBaseIds(lastUserMessage)
  const hasKnowledgeBase = !isEmpty(knowledgeBaseIds)
  const webSearchProvider = WebSearchService.getWebSearchProvider(assistant.webSearchProviderId)

  // --- Keyword/Question Extraction Function ---
  const extract = async (): Promise<ExtractResults | undefined> => {
    if (!lastUserMessage) return undefined
    // 如果都不需要搜索，则直接返回，不意图识别
    if (!shouldWebSearch && !hasKnowledgeBase) return undefined

    // Notify UI that extraction/searching is starting
    onChunkReceived({ type: ChunkType.EXTERNEL_TOOL_IN_PROGRESS })

    let prompt = ''

    if (shouldWebSearch && !hasKnowledgeBase) {
      prompt = SEARCH_SUMMARY_PROMPT_WEB_ONLY
    } else if (!shouldWebSearch && hasKnowledgeBase) {
      prompt = SEARCH_SUMMARY_PROMPT_KNOWLEDGE_ONLY
    } else {
      prompt = SEARCH_SUMMARY_PROMPT
    }

    const summaryAssistant = getDefaultAssistant()
    summaryAssistant.model = assistant.model || getDefaultModel()
    summaryAssistant.prompt = prompt

    const getFallbackResult = (): ExtractResults => {
      const fallbackContent = getMainTextContent(lastUserMessage)
      return {
        websearch: shouldWebSearch
          ? {
              question: [fallbackContent || 'search']
            }
          : undefined,
        knowledge: hasKnowledgeBase
          ? {
              question: [fallbackContent || 'search']
            }
          : undefined
      } as ExtractResults
    }

    try {
      const keywords = await fetchSearchSummary({
        messages: lastAnswer ? [lastAnswer, lastUserMessage] : [lastUserMessage],
        assistant: summaryAssistant
      })

      return keywords ? extractInfoFromXML(keywords) : getFallbackResult()
    } catch (e: any) {
      console.error('extract error', e)
      if (isAbortError(e)) throw e
      return getFallbackResult()
    }
  }

  // --- Web Search Function ---
  const searchTheWeb = async (): Promise<WebSearchResponse | undefined> => {
    // Add check for extractResults existence early
    if (!extractResults?.websearch) {
      console.warn('searchTheWeb called without valid extractResults.websearch')
      return
    }

    if (!shouldWebSearch) return

    // Add check for assistant.model before using it
    if (!assistant.model) {
      console.warn('searchTheWeb called without assistant.model')
      return undefined
    }

    // Pass the guaranteed model to the check function
    const webSearchParams = getOpenAIWebSearchParams(assistant, assistant.model)
    if (!isEmpty(webSearchParams) || isOpenAIWebSearch(assistant.model)) {
      console.log('Using built-in OpenAI web search, skipping external search.')
      return
    }

    console.log('Performing external web search...')
    try {
      // Use the consolidated processWebsearch function
      WebSearchService.createAbortSignal(lastUserMessage.id)
      return {
        results: await WebSearchService.processWebsearch(webSearchProvider!, extractResults),
        source: WebSearchSource.WEBSEARCH
      }
    } catch (error) {
      console.error('Web search failed:', error)
      if (isAbortError(error)) throw error
      return
    }
  }

  // --- Knowledge Base Search Function ---
  const searchKnowledgeBase = async (): Promise<KnowledgeReference[] | undefined> => {
    // Add check for extractResults existence early
    if (!extractResults?.knowledge) {
      console.warn('searchKnowledgeBase called without valid extractResults.knowledge')
      return
    }

    const shouldSearch = hasKnowledgeBase && extractResults.knowledge.question[0] !== 'not_needed'

    if (!shouldSearch) return

    console.log('Performing knowledge base search...')
    try {
      // Attempt to get knowledgeBaseIds from the main text block
      // NOTE: This assumes knowledgeBaseIds are ONLY on the main text block
      // NOTE: processKnowledgeSearch needs to handle undefined ids gracefully
      // const mainTextBlock = mainTextBlocks
      //   ?.map((blockId) => store.getState().messageBlocks.entities[blockId])
      //   .find((block) => block?.type === MessageBlockType.MAIN_TEXT) as MainTextMessageBlock | undefined
      return await processKnowledgeSearch(extractResults, knowledgeBaseIds)
    } catch (error) {
      console.error('Knowledge base search failed:', error)
      return
    }
  }

  const shouldWebSearch = !!assistant.webSearchProviderId

  // --- Execute Extraction and Searches ---
  const extractResults = await extract()
  // console.log('extractResults', extractResults)
  // Run searches potentially in parallel

  let webSearchResponseFromSearch: WebSearchResponse | undefined
  let knowledgeReferencesFromSearch: KnowledgeReference[] | undefined
  const isWebSearchValid = extractResults?.websearch && assistant.model
  const isKnowledgeSearchValid = extractResults?.knowledge
  const isAllValidSearch = lastUserMessage && (isKnowledgeSearchValid || isWebSearchValid)

  if (isAllValidSearch) {
    // TODO: 应该在这写search开始
    if (isKnowledgeSearchValid && isWebSearchValid) {
      ;[webSearchResponseFromSearch, knowledgeReferencesFromSearch] = await Promise.all([
        searchTheWeb(),
        searchKnowledgeBase()
      ])
    } else if (isKnowledgeSearchValid) {
      knowledgeReferencesFromSearch = await searchKnowledgeBase()
    } else if (isWebSearchValid) {
      webSearchResponseFromSearch = await searchTheWeb()
    }
    // Search判断很准确了，可以在这写search结束
    onChunkReceived({
      type: ChunkType.EXTERNEL_TOOL_COMPLETE,
      external_tool: {
        webSearch: webSearchResponseFromSearch,
        knowledge: knowledgeReferencesFromSearch
      }
    })
  }

  // --- Prepare for AI Completion ---
  // Store results temporarily (e.g., using window.keyv like before)
  if (lastUserMessage) {
    if (webSearchResponseFromSearch) {
      window.keyv.set(`web-search-${lastUserMessage.id}`, webSearchResponseFromSearch)
    }
    if (knowledgeReferencesFromSearch) {
      window.keyv.set(`knowledge-search-${lastUserMessage.id}`, knowledgeReferencesFromSearch)
    }
  }

  // Get MCP tools (Fix duplicate declaration)
  let mcpTools: MCPTool[] = [] // Initialize as empty array
  const enabledMCPs = lastUserMessage?.enabledMCPs
  if (enabledMCPs && enabledMCPs.length > 0) {
    try {
      const toolPromises = enabledMCPs.map(async (mcpServer) => {
        const tools = await window.api.mcp.listTools(mcpServer)
        return tools.filter((tool: any) => !mcpServer.disabledTools?.includes(tool.name))
      })
      const results = await Promise.all(toolPromises)
      mcpTools = results.flat() // Flatten the array of arrays
    } catch (toolError) {
      console.error('Error fetching MCP tools:', toolError)
    }
  }

  return { mcpTools }
}

export async function fetchChatCompletion({
  messages,
  assistant,
  onChunkReceived
}: {
  messages: Message[]
  assistant: Assistant
  onChunkReceived: (chunk: Chunk) => void
  // TODO
  // onChunkStatus: (status: 'searching' | 'processing' | 'success' | 'error') => void
}) {
  console.log('[DEBUG] fetchChatCompletion started')
  const provider = getAssistantProvider(assistant)
  console.log('[DEBUG] Got assistant provider:', provider.id)
  const AI = new AiProvider(provider)

  const lastUserMessage = findLast(messages, (m) => m.role === 'user')
  const lastAnswer = findLast(messages, (m) => m.role === 'assistant')
  if (!lastUserMessage) {
    console.error('fetchChatCompletion returning early: Missing lastUserMessage or lastAnswer')
    return
  }
  // try {
  // NOTE: The search results are NOT added to the messages sent to the AI here.
  // They will be retrieved and used by the messageThunk later to create CitationBlocks.
  const { mcpTools } = await fetchExternalTool(lastUserMessage, assistant, onChunkReceived, lastAnswer)

  const filteredMessages = filterUsefulMessages(filterContextMessages(messages))

  // --- Call AI Completions ---
  console.log('[DEBUG] Calling AI.completions')
  await AI.completions({
    messages: filteredMessages,
    assistant,
    onFilterMessages: () => {},
    onChunk: onChunkReceived,
    mcpTools: mcpTools
  })
  console.log('[DEBUG] AI.completions call finished')
}

interface FetchTranslateProps {
  content: string
  assistant: Assistant
  onResponse?: (text: string, isComplete: boolean) => void
}

export async function fetchTranslate({ content, assistant, onResponse }: FetchTranslateProps) {
  const model = getTranslateModel()

  if (!model) {
    throw new Error(i18n.t('error.provider_disabled'))
  }

  const provider = getProviderByModel(model)

  if (!hasApiKey(provider)) {
    throw new Error(i18n.t('error.no_api_key'))
  }

  const AI = new AiProvider(provider)

  try {
    return await AI.translate(content, assistant, onResponse)
  } catch (error: any) {
    return ''
  }
}

export async function fetchMessagesSummary({ messages, assistant }: { messages: Message[]; assistant: Assistant }) {
  const model = getTopNamingModel() || assistant.model || getDefaultModel()
  const provider = getProviderByModel(model)

  if (!hasApiKey(provider)) {
    return null
  }

  const AI = new AiProvider(provider)

  try {
    const text = await AI.summaries(filterMessages(messages), assistant)
    return text?.replace(/["']/g, '') || null
  } catch (error: any) {
    return null
  }
}

export async function fetchSearchSummary({ messages, assistant }: { messages: Message[]; assistant: Assistant }) {
  const model = assistant.model || getDefaultModel()
  const provider = getProviderByModel(model)

  if (!hasApiKey(provider)) {
    return null
  }

  const AI = new AiProvider(provider)

  return await AI.summaryForSearch(messages, assistant)
}

export async function fetchGenerate({ prompt, content }: { prompt: string; content: string }): Promise<string> {
  const model = getDefaultModel()
  const provider = getProviderByModel(model)

  if (!hasApiKey(provider)) {
    return ''
  }

  const AI = new AiProvider(provider)

  try {
    return await AI.generateText({ prompt, content })
  } catch (error: any) {
    return ''
  }
}

export async function fetchSuggestions({
  messages,
  assistant
}: {
  messages: Message[]
  assistant: Assistant
}): Promise<Suggestion[]> {
  const model = assistant.model
  if (!model || model.id.endsWith('global')) {
    return []
  }

  const provider = getAssistantProvider(assistant)
  const AI = new AiProvider(provider)

  try {
    return await AI.suggestions(filterMessages(messages), assistant)
  } catch (error: any) {
    return []
  }
}

function hasApiKey(provider: Provider) {
  if (!provider) return false
  if (provider.id === 'ollama' || provider.id === 'lmstudio') return true
  return !isEmpty(provider.apiKey)
}

export async function fetchModels(provider: Provider) {
  const AI = new AiProvider(provider)

  try {
    return await AI.models()
  } catch (error) {
    return []
  }
}

export const formatApiKeys = (value: string) => {
  return value.replaceAll('，', ',').replaceAll(' ', ',').replaceAll(' ', '').replaceAll('\n', ',')
}

export function checkApiProvider(provider: Provider): {
  valid: boolean
  error: Error | null
} {
  const key = 'api-check'
  const style = { marginTop: '3vh' }

  if (provider.id !== 'ollama' && provider.id !== 'lmstudio') {
    if (!provider.apiKey) {
      window.message.error({ content: i18n.t('message.error.enter.api.key'), key, style })
      return {
        valid: false,
        error: new Error(i18n.t('message.error.enter.api.key'))
      }
    }
  }

  if (!provider.apiHost) {
    window.message.error({ content: i18n.t('message.error.enter.api.host'), key, style })
    return {
      valid: false,
      error: new Error(i18n.t('message.error.enter.api.host'))
    }
  }

  if (isEmpty(provider.models)) {
    window.message.error({ content: i18n.t('message.error.enter.model'), key, style })
    return {
      valid: false,
      error: new Error(i18n.t('message.error.enter.model'))
    }
  }

  return {
    valid: true,
    error: null
  }
}

export async function checkApi(provider: Provider, model: Model) {
  const validation = checkApiProvider(provider)
  if (!validation.valid) {
    return {
      valid: validation.valid,
      error: validation.error
    }
  }

  const AI = new AiProvider(provider)

  const { valid, error } = await AI.check(model)

  return {
    valid,
    error
  }
}
