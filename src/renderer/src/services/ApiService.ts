import { CompletionsParams } from '@renderer/aiCore/middleware/schemas'
import Logger from '@renderer/config/logger'
import {
  isEmbeddingModel,
  isGenerateImageModel,
  isOpenRouterBuiltInWebSearchModel,
  isReasoningModel,
  isSupportedDisableGenerationModel,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenModel,
  isWebSearchModel
} from '@renderer/config/models'
import {
  SEARCH_SUMMARY_PROMPT,
  SEARCH_SUMMARY_PROMPT_KNOWLEDGE_ONLY,
  SEARCH_SUMMARY_PROMPT_WEB_ONLY
} from '@renderer/config/prompts'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import {
  Assistant,
  ExternalToolResult,
  KnowledgeReference,
  MCPTool,
  Model,
  Provider,
  WebSearchResponse,
  WebSearchSource
} from '@renderer/types'
import { type Chunk, ChunkType } from '@renderer/types/chunk'
import { Message } from '@renderer/types/newMessage'
import { SdkModel } from '@renderer/types/sdk'
import { removeSpecialCharactersForTopicName } from '@renderer/utils'
import { isAbortError } from '@renderer/utils/error'
import { extractInfoFromXML, ExtractResults } from '@renderer/utils/extract'
import { findFileBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { findLast, isEmpty, takeRight } from 'lodash'

import AiProvider from '../aiCore'
import store from '../store'
import {
  getAssistantProvider,
  getAssistantSettings,
  getDefaultModel,
  getProviderByModel,
  getTopNamingModel,
  getTranslateModel
} from './AssistantService'
import { getDefaultAssistant } from './AssistantService'
import { processKnowledgeSearch } from './KnowledgeService'
import {
  filterContextMessages,
  filterEmptyMessages,
  filterUsefulMessages,
  filterUserRoleStartMessages
} from './MessagesService'
import WebSearchService from './WebSearchService'

// TODO：考虑拆开
async function fetchExternalTool(
  lastUserMessage: Message,
  assistant: Assistant,
  onChunkReceived: (chunk: Chunk) => void,
  lastAnswer?: Message
): Promise<ExternalToolResult> {
  // 可能会有重复？
  const knowledgeBaseIds = assistant.knowledge_bases?.map((base) => base.id)
  const hasKnowledgeBase = !isEmpty(knowledgeBaseIds)
  const knowledgeRecognition = assistant.knowledgeRecognition || 'on'
  const webSearchProvider = WebSearchService.getWebSearchProvider(assistant.webSearchProviderId)

  // 使用外部搜索工具
  const shouldWebSearch = !!assistant.webSearchProviderId && webSearchProvider !== null
  const shouldKnowledgeSearch = hasKnowledgeBase

  // 在工具链开始时发送进度通知
  const willUseTools = shouldWebSearch || shouldKnowledgeSearch
  if (willUseTools) {
    onChunkReceived({ type: ChunkType.EXTERNEL_TOOL_IN_PROGRESS })
  }

  // --- Keyword/Question Extraction Function ---
  const extract = async (): Promise<ExtractResults | undefined> => {
    if (!lastUserMessage) return undefined

    // 根据配置决定是否需要提取
    const needWebExtract = shouldWebSearch
    const needKnowledgeExtract = hasKnowledgeBase && knowledgeRecognition === 'on'

    if (!needWebExtract && !needKnowledgeExtract) return undefined

    let prompt: string
    if (needWebExtract && !needKnowledgeExtract) {
      prompt = SEARCH_SUMMARY_PROMPT_WEB_ONLY
    } else if (!needWebExtract && needKnowledgeExtract) {
      prompt = SEARCH_SUMMARY_PROMPT_KNOWLEDGE_ONLY
    } else {
      prompt = SEARCH_SUMMARY_PROMPT
    }

    const summaryAssistant = getDefaultAssistant()
    summaryAssistant.model = assistant.model || getDefaultModel()
    summaryAssistant.prompt = prompt

    try {
      const result = await fetchSearchSummary({
        messages: lastAnswer ? [lastAnswer, lastUserMessage] : [lastUserMessage],
        assistant: summaryAssistant
      })

      if (!result) return getFallbackResult()

      const extracted = extractInfoFromXML(result.getText())
      // 根据需求过滤结果
      return {
        websearch: needWebExtract ? extracted?.websearch : undefined,
        knowledge: needKnowledgeExtract ? extracted?.knowledge : undefined
      }
    } catch (e: any) {
      console.error('extract error', e)
      if (isAbortError(e)) throw e
      return getFallbackResult()
    }
  }

  const getFallbackResult = (): ExtractResults => {
    const fallbackContent = getMainTextContent(lastUserMessage)
    return {
      websearch: shouldWebSearch ? { question: [fallbackContent || 'search'] } : undefined,
      knowledge: shouldKnowledgeSearch
        ? {
            question: [fallbackContent || 'search'],
            rewrite: fallbackContent
          }
        : undefined
    }
  }

  // --- Web Search Function ---
  const searchTheWeb = async (extractResults: ExtractResults | undefined): Promise<WebSearchResponse | undefined> => {
    if (!shouldWebSearch) return

    // Add check for extractResults existence early
    if (!extractResults?.websearch) {
      console.warn('searchTheWeb called without valid extractResults.websearch')
      return
    }

    if (extractResults.websearch.question[0] === 'not_needed') return

    // Add check for assistant.model before using it
    if (!assistant.model) {
      console.warn('searchTheWeb called without assistant.model')
      return undefined
    }

    try {
      // Use the consolidated processWebsearch function
      WebSearchService.createAbortSignal(lastUserMessage.id)
      const webSearchResponse = await WebSearchService.processWebsearch(
        webSearchProvider!,
        extractResults,
        lastUserMessage.id
      )
      return {
        results: webSearchResponse,
        source: WebSearchSource.WEBSEARCH
      }
    } catch (error) {
      if (isAbortError(error)) throw error
      console.error('Web search failed:', error)
      return
    }
  }

  // --- Knowledge Base Search Function ---
  const searchKnowledgeBase = async (
    extractResults: ExtractResults | undefined
  ): Promise<KnowledgeReference[] | undefined> => {
    if (!hasKnowledgeBase) return

    // 知识库搜索条件
    let searchCriteria: { question: string[]; rewrite: string }
    if (knowledgeRecognition === 'off') {
      const directContent = getMainTextContent(lastUserMessage)
      searchCriteria = { question: [directContent || 'search'], rewrite: directContent }
    } else {
      // auto mode
      if (!extractResults?.knowledge) {
        console.warn('searchKnowledgeBase: No valid search criteria in auto mode')
        return
      }
      searchCriteria = extractResults.knowledge
    }

    if (searchCriteria.question[0] === 'not_needed') return

    try {
      const tempExtractResults: ExtractResults = {
        websearch: undefined,
        knowledge: searchCriteria
      }
      // Attempt to get knowledgeBaseIds from the main text block
      // NOTE: This assumes knowledgeBaseIds are ONLY on the main text block
      // NOTE: processKnowledgeSearch needs to handle undefined ids gracefully
      // const mainTextBlock = mainTextBlocks
      //   ?.map((blockId) => store.getState().messageBlocks.entities[blockId])
      //   .find((block) => block?.type === MessageBlockType.MAIN_TEXT) as MainTextMessageBlock | undefined
      return await processKnowledgeSearch(tempExtractResults, knowledgeBaseIds)
    } catch (error) {
      console.error('Knowledge base search failed:', error)
      return
    }
  }

  // --- Execute Extraction and Searches ---
  let extractResults: ExtractResults | undefined

  try {
    // 根据配置决定是否需要提取
    if (shouldWebSearch || hasKnowledgeBase) {
      extractResults = await extract()
      Logger.log('[fetchExternalTool] Extraction results:', extractResults)
    }

    let webSearchResponseFromSearch: WebSearchResponse | undefined
    let knowledgeReferencesFromSearch: KnowledgeReference[] | undefined

    // 并行执行搜索
    if (shouldWebSearch || shouldKnowledgeSearch) {
      ;[webSearchResponseFromSearch, knowledgeReferencesFromSearch] = await Promise.all([
        searchTheWeb(extractResults),
        searchKnowledgeBase(extractResults)
      ])
    }

    // 存储搜索结果
    if (lastUserMessage) {
      if (webSearchResponseFromSearch) {
        window.keyv.set(`web-search-${lastUserMessage.id}`, webSearchResponseFromSearch)
      }
      if (knowledgeReferencesFromSearch) {
        window.keyv.set(`knowledge-search-${lastUserMessage.id}`, knowledgeReferencesFromSearch)
      }
    }

    // 发送工具执行完成通知
    if (willUseTools) {
      onChunkReceived({
        type: ChunkType.EXTERNEL_TOOL_COMPLETE,
        external_tool: {
          webSearch: webSearchResponseFromSearch,
          knowledge: knowledgeReferencesFromSearch
        }
      })
    }

    // Get MCP tools (Fix duplicate declaration)
    let mcpTools: MCPTool[] = [] // Initialize as empty array
    const allMcpServers = store.getState().mcp.servers || []
    const activedMcpServers = allMcpServers.filter((s) => s.isActive)
    const assistantMcpServers = assistant.mcpServers || []

    const enabledMCPs = activedMcpServers.filter((server) => assistantMcpServers.some((s) => s.id === server.id))

    if (enabledMCPs && enabledMCPs.length > 0) {
      try {
        const toolPromises = enabledMCPs.map<Promise<MCPTool[]>>(async (mcpServer) => {
          try {
            const tools = await window.api.mcp.listTools(mcpServer)
            return tools.filter((tool: any) => !mcpServer.disabledTools?.includes(tool.name))
          } catch (error) {
            console.error(`Error fetching tools from MCP server ${mcpServer.name}:`, error)
            return []
          }
        })
        const results = await Promise.allSettled(toolPromises)
        mcpTools = results
          .filter((result): result is PromiseFulfilledResult<MCPTool[]> => result.status === 'fulfilled')
          .map((result) => result.value)
          .flat()
      } catch (toolError) {
        console.error('Error fetching MCP tools:', toolError)
      }
    }

    return { mcpTools }
  } catch (error) {
    if (isAbortError(error)) throw error
    console.error('Tool execution failed:', error)

    // 发送错误状态
    if (willUseTools) {
      onChunkReceived({
        type: ChunkType.EXTERNEL_TOOL_COMPLETE,
        external_tool: {
          webSearch: undefined,
          knowledge: undefined
        }
      })
    }

    return { mcpTools: [] }
  }
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
  console.log('fetchChatCompletion', messages, assistant)

  const provider = getAssistantProvider(assistant)
  const AI = new AiProvider(provider)

  // Make sure that 'Clear Context' works for all scenarios including external tool and normal chat.
  messages = filterContextMessages(messages)

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
  const model = assistant.model || getDefaultModel()

  const { maxTokens, contextCount } = getAssistantSettings(assistant)

  const filteredMessages = filterUsefulMessages(messages)

  const _messages = filterUserRoleStartMessages(
    filterEmptyMessages(filterContextMessages(takeRight(filteredMessages, contextCount + 2))) // 取原来几个provider的最大值
  )

  const enableReasoning =
    ((isSupportedThinkingTokenModel(model) || isSupportedReasoningEffortModel(model)) &&
      assistant.settings?.reasoning_effort !== undefined) ||
    (isReasoningModel(model) && (!isSupportedThinkingTokenModel(model) || !isSupportedReasoningEffortModel(model)))

  const enableWebSearch =
    (assistant.enableWebSearch && isWebSearchModel(model)) ||
    isOpenRouterBuiltInWebSearchModel(model) ||
    model.id.includes('sonar') ||
    false

  const enableGenerateImage =
    isGenerateImageModel(model) && (isSupportedDisableGenerationModel(model) ? assistant.enableGenerateImage : true)

  // --- Call AI Completions ---
  onChunkReceived({ type: ChunkType.LLM_RESPONSE_CREATED })
  await AI.completions(
    {
      callType: 'chat',
      messages: _messages,
      assistant,
      onChunk: onChunkReceived,
      mcpTools: mcpTools,
      maxTokens,
      streamOutput: assistant.settings?.streamOutput || false,
      enableReasoning,
      enableWebSearch,
      enableGenerateImage
    },
    {
      streamOutput: assistant.settings?.streamOutput || false
    }
  )
}

interface FetchTranslateProps {
  content: string
  assistant: Assistant
  onResponse?: (text: string, isComplete: boolean) => void
}

export async function fetchTranslate({ content, assistant, onResponse }: FetchTranslateProps) {
  const model = getTranslateModel() || assistant.model || getDefaultModel()

  if (!model) {
    throw new Error(i18n.t('error.provider_disabled'))
  }

  const provider = getProviderByModel(model)

  if (!hasApiKey(provider)) {
    throw new Error(i18n.t('error.no_api_key'))
  }

  const isSupportedStreamOutput = () => {
    if (!onResponse) {
      return false
    }
    return true
  }

  const stream = isSupportedStreamOutput()
  const enableReasoning =
    ((isSupportedThinkingTokenModel(model) || isSupportedReasoningEffortModel(model)) &&
      assistant.settings?.reasoning_effort !== undefined) ||
    (isReasoningModel(model) && (!isSupportedThinkingTokenModel(model) || !isSupportedReasoningEffortModel(model)))

  const params: CompletionsParams = {
    callType: 'translate',
    messages: content,
    assistant: { ...assistant, model },
    streamOutput: stream,
    enableReasoning,
    onResponse
  }

  const AI = new AiProvider(provider)

  try {
    return (await AI.completions(params)).getText() || ''
  } catch (error: any) {
    return ''
  }
}

export async function fetchMessagesSummary({ messages, assistant }: { messages: Message[]; assistant: Assistant }) {
  const prompt = (getStoreSetting('topicNamingPrompt') as string) || i18n.t('prompts.title')
  const model = getTopNamingModel() || assistant.model || getDefaultModel()

  // 总结上下文总是取最后5条消息
  const contextMessages = takeRight(messages, 5)

  const provider = getProviderByModel(model)

  if (!hasApiKey(provider)) {
    return null
  }

  const AI = new AiProvider(provider)

  // LLM对多条消息的总结有问题，用单条结构化的消息表示会话内容会更好
  const structredMessages = contextMessages.map((message) => {
    const structredMessage = {
      role: message.role,
      mainText: getMainTextContent(message)
    }

    // 让LLM知道消息中包含的文件，但只提供文件名
    // 对助手消息而言，没有提供工具调用结果等更多信息，仅提供文本上下文。
    const fileBlocks = findFileBlocks(message)
    let fileList: Array<string> = []
    if (fileBlocks.length && fileBlocks.length > 0) {
      fileList = fileBlocks.map((fileBlock) => fileBlock.file.origin_name)
    }
    return {
      ...structredMessage,
      files: fileList.length > 0 ? fileList : undefined
    }
  })
  const conversation = JSON.stringify(structredMessages)

  // 复制 assistant 对象，并强制关闭思考预算
  const summaryAssistant = {
    ...assistant,
    settings: {
      ...assistant.settings,
      reasoning_effort: undefined,
      qwenThinkMode: false
    }
  }

  const params: CompletionsParams = {
    callType: 'summary',
    messages: conversation,
    assistant: { ...summaryAssistant, prompt, model },
    maxTokens: 1000,
    streamOutput: false,
    enableReasoning: false
  }

  try {
    const { getText } = await AI.completions(params)
    const text = getText()
    return removeSpecialCharactersForTopicName(text) || null
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

  const params: CompletionsParams = {
    callType: 'search',
    messages: messages,
    assistant,
    streamOutput: false
  }

  return await AI.completions(params)
}

export async function fetchGenerate({ prompt, content }: { prompt: string; content: string }): Promise<string> {
  const model = getDefaultModel()
  const provider = getProviderByModel(model)

  if (!hasApiKey(provider)) {
    return ''
  }

  const AI = new AiProvider(provider)

  const assistant = getDefaultAssistant()
  assistant.model = model
  assistant.prompt = prompt

  const params: CompletionsParams = {
    callType: 'generate',
    messages: content,
    assistant,
    streamOutput: false
  }

  try {
    const result = await AI.completions(params)
    return result.getText() || ''
  } catch (error: any) {
    return ''
  }
}

function hasApiKey(provider: Provider) {
  if (!provider) return false
  if (provider.id === 'ollama' || provider.id === 'lmstudio' || provider.type === 'vertexai') return true
  return !isEmpty(provider.apiKey)
}

export async function fetchModels(provider: Provider): Promise<SdkModel[]> {
  const AI = new AiProvider(provider)

  try {
    return await AI.models()
  } catch (error) {
    return []
  }
}

export function checkApiProvider(provider: Provider): void {
  const key = 'api-check'
  const style = { marginTop: '3vh' }

  if (
    provider.id !== 'ollama' &&
    provider.id !== 'lmstudio' &&
    provider.type !== 'vertexai' &&
    provider.id !== 'copilot'
  ) {
    if (!provider.apiKey) {
      window.message.error({ content: i18n.t('message.error.enter.api.key'), key, style })
      throw new Error(i18n.t('message.error.enter.api.key'))
    }
  }

  if (!provider.apiHost && provider.type !== 'vertexai') {
    window.message.error({ content: i18n.t('message.error.enter.api.host'), key, style })
    throw new Error(i18n.t('message.error.enter.api.host'))
  }

  if (isEmpty(provider.models)) {
    window.message.error({ content: i18n.t('message.error.enter.model'), key, style })
    throw new Error(i18n.t('message.error.enter.model'))
  }
}

export async function checkApi(provider: Provider, model: Model): Promise<void> {
  checkApiProvider(provider)

  const ai = new AiProvider(provider)

  const assistant = getDefaultAssistant()
  assistant.model = model
  try {
    if (isEmbeddingModel(model)) {
      await ai.getEmbeddingDimensions(model)
    } else {
      const params: CompletionsParams = {
        callType: 'check',
        messages: 'hi',
        assistant,
        streamOutput: true,
        enableReasoning: false,
        shouldThrow: true
      }

      // Try streaming check first
      const result = await ai.completions(params)
      if (!result.getText()) {
        throw new Error('No response received')
      }
    }
  } catch (error: any) {
    if (error.message.includes('stream')) {
      const params: CompletionsParams = {
        callType: 'check',
        messages: 'hi',
        assistant,
        streamOutput: false,
        shouldThrow: true
      }
      const result = await ai.completions(params)
      if (!result.getText()) {
        throw new Error('No response received')
      }
    } else {
      throw error
    }
  }
}
