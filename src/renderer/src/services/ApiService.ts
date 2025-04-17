import { getOpenAIWebSearchParams, isOpenAIWebSearch } from '@renderer/config/models'
import { SEARCH_SUMMARY_PROMPT } from '@renderer/config/prompts'
import i18n from '@renderer/i18n'
import type { ChunkCallbackData } from '@renderer/providers/AiProvider'
import type { Assistant, MCPTool, Model, Provider, Suggestion, WebSearchResponse } from '@renderer/types'
import type { Message } from '@renderer/types/newMessageTypes'
import { fetchWebContents } from '@renderer/utils/fetch'
import { filterContextMessages, filterMessages, filterUsefulMessages } from '@renderer/utils/messageUtils/filters'
import { getMessageContent } from '@renderer/utils/messageUtils/find'
import { findLast, isEmpty } from 'lodash'

import AiProvider from '../providers/AiProvider'
import {
  getAssistantProvider,
  getDefaultAssistant,
  getDefaultModel,
  getProviderByModel,
  getTopNamingModel,
  getTranslateModel
} from './AssistantService'
import WebSearchService from './WebSearchService'

export async function fetchChatCompletion({
  messages,
  assistant,
  onChunkReceived
}: {
  messages: Message[]
  assistant: Assistant
  onChunkReceived: (chunk: ChunkCallbackData | { type: 'final'; status: 'success' | 'error'; error?: any }) => void
}) {
  const provider = getAssistantProvider(assistant)
  const webSearchProvider = WebSearchService.getWebSearchProvider()
  const AI = new AiProvider(provider)

  const searchTheWeb = async (): Promise<WebSearchResponse | null> => {
    if (WebSearchService.isWebSearchEnabled() && assistant.enableWebSearch && assistant.model) {
      let query = ''
      let webSearchResponse: WebSearchResponse = { results: [] }
      const webSearchParams = getOpenAIWebSearchParams(assistant, assistant.model)

      if (isEmpty(webSearchParams) && !isOpenAIWebSearch(assistant.model)) {
        const lastMessage = findLast(messages, (m) => m.role === 'user')

        if (lastMessage) {
          try {
            const searchSummaryAssistant = getDefaultAssistant()
            searchSummaryAssistant.model = assistant.model || getDefaultModel()
            searchSummaryAssistant.prompt = SEARCH_SUMMARY_PROMPT

            if (WebSearchService.isEnhanceModeEnabled()) {
              const keywords = await fetchSearchSummary({
                messages: messages,
                assistant: searchSummaryAssistant
              })

              try {
                const result = WebSearchService.extractInfoFromXML(keywords || '')
                if (result.question === 'not_needed') {
                  console.log('No need to search')
                  return null
                } else if (result.question === 'summarize' && result.links && result.links.length > 0) {
                  const contents = await fetchWebContents(result.links)
                  webSearchResponse = { query: 'summaries', results: contents }
                } else {
                  query = result.question
                  webSearchResponse = await WebSearchService.search(webSearchProvider, query)
                }
              } catch (error) {
                console.error('Failed to extract info from XML:', error)
                return null
              }
            } else {
              query = getMessageContent(lastMessage)

              if (query) {
                webSearchResponse = await WebSearchService.search(webSearchProvider, query)
              } else {
                console.warn('Cannot search, last user message has no content in its main block.')
                return null
              }
            }

            window.keyv.set(`web-search-${lastMessage.id}`, webSearchResponse)
            return webSearchResponse
          } catch (error) {
            console.error('Web search failed:', error)
            return null
          }
        }
      }
    }
    return null
  }

  try {
    await searchTheWeb()

    const lastUserMessage = findLast(messages, (m) => m.role === 'user')
    const enabledMCPs = lastUserMessage?.enabledMCPs
    const mcpTools: MCPTool[] = []
    if (enabledMCPs && enabledMCPs.length > 0) {
      for (const mcpServer of enabledMCPs) {
        const tools = await window.api.mcp.listTools(mcpServer)
        const availableTools = tools.filter((tool: any) => !mcpServer.disabledTools?.includes(tool.name))
        mcpTools.push(...availableTools)
      }
    }

    const filteredMessages = filterUsefulMessages(filterContextMessages(messages))

    await AI.completions({
      messages: filteredMessages,
      assistant,
      onFilterMessages: () => {},
      onChunk: (chunkData: ChunkCallbackData) => {
        onChunkReceived(chunkData)
      },
      mcpTools: mcpTools
    })
    onChunkReceived({ type: 'final', status: 'success' })
  } catch (error: any) {
    console.error('Error during AI.completions call:', error)
    onChunkReceived({ type: 'final', status: 'error', error })
    throw error
  }
}

interface FetchTranslateProps {
  message: Message
  assistant: Assistant
  onResponse?: (text: string) => void
}

export async function fetchTranslate({ message, assistant, onResponse }: FetchTranslateProps) {
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
    return await AI.translate(message, assistant, onResponse)
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

  try {
    return await AI.summaryForSearch(messages, assistant)
  } catch (error: any) {
    return null
  }
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
