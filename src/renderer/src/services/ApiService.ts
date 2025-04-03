import { getOpenAIWebSearchParams } from '@renderer/config/models'
import { EMOJI_GENERATOR_PROMPT, SEARCH_SUMMARY_PROMPT } from '@renderer/config/prompts'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { setGenerating } from '@renderer/store/runtime'
import { Assistant, MCPTool, Message, Model, Provider, Suggestion } from '@renderer/types'
import { formatMessageError, isAbortError } from '@renderer/utils/error'
import { withGenerateImage } from '@renderer/utils/formats'
import { cloneDeep, findLast, isEmpty } from 'lodash'

import AiProvider from '../providers/AiProvider'
import {
  getAssistantProvider,
  getDefaultAssistant,
  getDefaultModel,
  getProviderByModel,
  getTopNamingModel,
  getTranslateModel
} from './AssistantService'
import { EVENT_NAMES, EventEmitter } from './EventService'
import { filterContextMessages, filterMessages, filterUsefulMessages } from './MessagesService'
import { estimateMessagesUsage } from './TokenService'
import WebSearchService from './WebSearchService'

export async function fetchChatCompletion({
  message,
  messages,
  assistant,
  onResponse
}: {
  message: Message
  messages: Message[]
  assistant: Assistant
  onResponse: (message: Message) => void
}) {
  const provider = getAssistantProvider(assistant)
  const webSearchProvider = WebSearchService.getWebSearchProvider()
  const AI = new AiProvider(provider)

  try {
    let _messages: Message[] = []
    let isFirstChunk = true
    let query = ''

    // Search web
    if (WebSearchService.isWebSearchEnabled() && assistant.enableWebSearch && assistant.model) {
      const webSearchParams = getOpenAIWebSearchParams(assistant, assistant.model)

      if (isEmpty(webSearchParams)) {
        const lastMessage = findLast(messages, (m) => m.role === 'user')
        const lastAnswer = findLast(messages, (m) => m.role === 'assistant')
        const hasKnowledgeBase = !isEmpty(lastMessage?.knowledgeBaseIds)

        if (lastMessage) {
          if (hasKnowledgeBase) {
            window.message.info({
              content: i18n.t('message.ignore.knowledge.base'),
              key: 'knowledge-base-no-match-info'
            })
          }

          // 更新消息状态为搜索中
          onResponse({ ...message, status: 'searching' })

          try {
            // 等待关键词生成完成
            const searchSummaryAssistant = getDefaultAssistant()
            searchSummaryAssistant.model = assistant.model || getDefaultModel()
            searchSummaryAssistant.prompt = SEARCH_SUMMARY_PROMPT

            // 如果启用搜索增强模式，则使用搜索增强模式
            if (WebSearchService.isEnhanceModeEnabled()) {
              const keywords = await fetchSearchSummary({
                messages: lastAnswer ? [lastAnswer, lastMessage] : [lastMessage],
                assistant: searchSummaryAssistant
              })
              if (keywords) {
                query = keywords
              }
            } else {
              query = lastMessage.content
            }

            // 等待搜索完成
            const webSearch = await WebSearchService.search(webSearchProvider, query)

            // 处理搜索结果
            message.metadata = {
              ...message.metadata,
              webSearch: webSearch
            }

            window.keyv.set(`web-search-${lastMessage?.id}`, webSearch)
          } catch (error) {
            console.error('Web search failed:', error)
          }
        }
      }
    }

    const lastUserMessage = findLast(messages, (m) => m.role === 'user')
    // Get MCP tools
    const mcpTools: MCPTool[] = []
    const enabledMCPs = lastUserMessage?.enabledMCPs

    if (enabledMCPs && enabledMCPs.length > 0) {
      for (const mcpServer of enabledMCPs) {
        const tools = await window.api.mcp.listTools(mcpServer)
        console.debug('tools', tools)
        mcpTools.push(...tools)
      }
    }

    await AI.completions({
      messages: filterUsefulMessages(filterContextMessages(messages)),
      assistant,
      onFilterMessages: (messages) => (_messages = messages),
      onChunk: ({ text, reasoning_content, usage, metrics, search, citations, mcpToolResponse, generateImage }) => {
        message.content = message.content + text || ''
        message.usage = usage
        message.metrics = metrics

        if (reasoning_content) {
          message.reasoning_content = (message.reasoning_content || '') + reasoning_content
        }

        if (search) {
          message.metadata = { ...message.metadata, groundingMetadata: search }
        }

        if (mcpToolResponse) {
          message.metadata = { ...message.metadata, mcpTools: cloneDeep(mcpToolResponse) }
        }

        if (generateImage && generateImage.images.length > 0) {
          const existingImages = message.metadata?.generateImage?.images || []
          generateImage.images = [...existingImages, ...generateImage.images]
          console.log('generateImage', generateImage)
          message.metadata = {
            ...message.metadata,
            generateImage: generateImage
          }
        }

        // Handle citations from Perplexity API
        if (isFirstChunk && citations) {
          message.metadata = {
            ...message.metadata,
            citations
          }
          isFirstChunk = false
        }

        onResponse({ ...message, status: 'pending' })
      },
      mcpTools: mcpTools
    })

    message.status = 'success'
    message = withGenerateImage(message)

    if (!message.usage || !message?.usage?.completion_tokens) {
      message.usage = await estimateMessagesUsage({
        assistant,
        messages: [..._messages, message]
      })
      // Set metrics.completion_tokens
      if (message.metrics && message?.usage?.completion_tokens) {
        if (!message.metrics?.completion_tokens) {
          message = {
            ...message,
            metrics: {
              ...message.metrics,
              completion_tokens: message.usage.completion_tokens
            }
          }
        }
      }
    }
    console.log('message', message)
  } catch (error: any) {
    if (isAbortError(error)) {
      message.status = 'paused'
    } else {
      message.status = 'error'
      message.error = formatMessageError(error)
    }
  }

  // Emit chat completion event
  EventEmitter.emit(EVENT_NAMES.RECEIVE_MESSAGE, message)
  onResponse(message)

  // Reset generating state
  store.dispatch(setGenerating(false))
  return message
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
    // Remove all quotes from the text
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

/**
 * 根据提示词生成emoji表情建议
 * @param prompt 提示词
 * @returns emoji表情
 */
export async function fetchEmojiSuggestion(prompt: string): Promise<string> {
  console.log('🔍fetchEmojiSuggestion被调用，提示词:', prompt)

  // 如果提示词为空，返回默认表情
  if (!prompt || prompt.trim() === '') {
    console.log('⚠️ 提示词为空，使用默认emoji')
    const defaultEmojis = ['🤖', '💡', '✨', '🧠', '📚']
    return defaultEmojis[Math.floor(Math.random() * defaultEmojis.length)]
  }

  try {
    // 尝试使用AI生成emoji
    const model = getDefaultModel()
    console.log('🔍使用模型:', model.id, model.name)
    const provider = getProviderByModel(model)
    console.log('🔍使用提供商:', provider.id, provider.name)

    if (!hasApiKey(provider)) {
      console.log('⚠️API密钥不存在，回退到本地生成')
      // 如果没有API密钥，回退到本地生成方式
      const { generateEmojiFromPrompt } = await import('@renderer/utils')
      return await generateEmojiFromPrompt(prompt)
    }

    console.log('✅开始使用AI生成emoji，提示词:', prompt)
    const AI = new AiProvider(provider)

    // 使用emoji生成提示词
    console.log('📝使用提示模板:', EMOJI_GENERATOR_PROMPT.substring(0, 50) + '...')
    const result = await AI.generateText({
      prompt: EMOJI_GENERATOR_PROMPT,
      content: prompt
    })
    console.log('🔍AI生成原始结果:', result)

    // 从结果中提取emoji
    if (result.includes('Emoji:')) {
      const match = result.match(/Emoji:\s*([^\s]+)/)
      const extractedEmoji = match ? match[1] : result
      console.log('✨提取的emoji:', extractedEmoji)
      return extractedEmoji
    }

    console.log('⚠️无法从AI结果中提取emoji，尝试使用原始结果')
    return result
  } catch (error) {
    console.error('❌Error generating emoji from prompt:', error)
    // 如果生成失败，回退到本地生成方式
    try {
      console.log('🔄AI生成失败，回退到本地生成')
      const { generateEmojiFromPrompt } = await import('@renderer/utils')
      return await generateEmojiFromPrompt(prompt)
    } catch (e) {
      console.error('❌Fallback emoji generation also failed:', e)
      // 如果本地生成也失败，返回默认表情
      console.log('⚠️本地生成也失败，使用默认emoji')
      const defaultEmojis = ['🤖', '💡', '✨', '🧠', '📚']
      return defaultEmojis[Math.floor(Math.random() * defaultEmojis.length)]
    }
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
  if (!model) {
    return []
  }

  if (model.owned_by !== 'graphrag') {
    return []
  }

  if (model.id.endsWith('global')) {
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

// Helper function to validate provider's basic settings such as API key, host, and model list
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

/**
 * Format API keys
 * @param value Raw key string
 * @returns Formatted key string
 */
export const formatApiKeys = (value: string) => {
  return value.replaceAll('，', ',').replaceAll(' ', ',').replaceAll(' ', '').replaceAll('\n', ',')
}
