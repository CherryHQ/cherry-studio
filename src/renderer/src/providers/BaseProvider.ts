import { FOOTNOTE_PROMPT, REFERENCE_PROMPT } from '@renderer/config/prompts'
import { getLMStudioKeepAliveTime } from '@renderer/hooks/useLMStudio'
import { getOllamaKeepAliveTime } from '@renderer/hooks/useOllama'
import { getKnowledgeBaseReferences } from '@renderer/services/KnowledgeService'
import type {
  Assistant,
  GenerateImageParams,
  KnowledgeReference,
  Message,
  Model,
  Provider,
  Suggestion
} from '@renderer/types'
import { delay, isJSON, parseJSON } from '@renderer/utils'
import { addAbortController, removeAbortController } from '@renderer/utils/abortController'
import { formatApiHost } from '@renderer/utils/api'
import { TavilySearchResponse } from '@tavily/core'
import { t } from 'i18next'
import { isEmpty } from 'lodash'
import type OpenAI from 'openai'

import type { CompletionsParams } from '.'

export default abstract class BaseProvider {
  protected provider: Provider
  protected host: string
  protected apiKey: string

  constructor(provider: Provider) {
    this.provider = provider
    this.host = this.getBaseURL()
    this.apiKey = this.getApiKey()
  }

  abstract completions({ messages, assistant, onChunk, onFilterMessages }: CompletionsParams): Promise<void>
  abstract translate(message: Message, assistant: Assistant, onResponse?: (text: string) => void): Promise<string>
  abstract summaries(messages: Message[], assistant: Assistant): Promise<string>
  abstract suggestions(messages: Message[], assistant: Assistant): Promise<Suggestion[]>
  abstract generateText({ prompt, content }: { prompt: string; content: string }): Promise<string>
  abstract check(model: Model): Promise<{ valid: boolean; error: Error | null }>
  abstract models(): Promise<OpenAI.Models.Model[]>
  abstract generateImage(params: GenerateImageParams): Promise<string[]>
  abstract getEmbeddingDimensions(model: Model): Promise<number>

  public getBaseURL(): string {
    const host = this.provider.apiHost
    return formatApiHost(host)
  }

  public getApiKey() {
    const keys = this.provider.apiKey.split(',').map((key) => key.trim())
    const keyName = `provider:${this.provider.id}:last_used_key`

    if (keys.length === 1) {
      return keys[0]
    }

    const lastUsedKey = window.keyv.get(keyName)
    if (!lastUsedKey) {
      window.keyv.set(keyName, keys[0])
      return keys[0]
    }

    const currentIndex = keys.indexOf(lastUsedKey)
    const nextIndex = (currentIndex + 1) % keys.length
    const nextKey = keys[nextIndex]
    window.keyv.set(keyName, nextKey)

    return nextKey
  }

  public defaultHeaders() {
    return {
      'X-Api-Key': this.apiKey
    }
  }

  public get keepAliveTime() {
    return this.provider.id === 'ollama'
      ? getOllamaKeepAliveTime()
      : this.provider.id === 'lmstudio'
        ? getLMStudioKeepAliveTime()
        : undefined
  }

  public async fakeCompletions({ onChunk }: CompletionsParams) {
    for (let i = 0; i < 100; i++) {
      await delay(0.01)
      onChunk({ text: i + '\n', usage: { completion_tokens: 0, prompt_tokens: 0, total_tokens: 0 } })
    }
  }

  public async getMessageContent(message: Message) {
    const webSearchReferences = await this.getWebSearchReferences(message)

    if (!isEmpty(webSearchReferences)) {
      const referenceContent = `\`\`\`json\n${JSON.stringify(webSearchReferences, null, 2)}\n\`\`\``
      return REFERENCE_PROMPT.replace('{question}', message.content).replace('{references}', referenceContent)
    }

    const knowledgeReferences = await getKnowledgeBaseReferences(message)

    if (!isEmpty(message.knowledgeBaseIds) && isEmpty(knowledgeReferences)) {
      window.message.info({ content: t('knowledge.no_match'), key: 'knowledge-base-no-match-info' })
    }

    if (!isEmpty(knowledgeReferences)) {
      const referenceContent = `\`\`\`json\n${JSON.stringify(knowledgeReferences, null, 2)}\n\`\`\``
      return FOOTNOTE_PROMPT.replace('{question}', message.content).replace('{references}', referenceContent)
    }

    return message.content
  }

  private async getWebSearchReferences(message: Message) {
    const webSearch: TavilySearchResponse = window.keyv.get(`web-search-${message.id}`)

    if (webSearch) {
      return webSearch.results.map(
        (result, index) =>
          ({
            id: index + 1,
            content: result.content,
            sourceUrl: result.url,
            type: 'url'
          }) as KnowledgeReference
      )
    }

    return []
  }

  protected getCustomParameters(assistant: Assistant) {
    return (
      assistant?.settings?.customParameters?.reduce((acc, param) => {
        if (!param.name?.trim()) {
          return acc
        }
        if (param.type === 'json') {
          const value = param.value as string
          if (value === 'undefined') {
            return { ...acc, [param.name]: undefined }
          }
          return { ...acc, [param.name]: isJSON(value) ? parseJSON(value) : value }
        }
        return {
          ...acc,
          [param.name]: param.value
        }
      }, {}) || {}
    )
  }

  protected createAbortController(messageId?: string) {
    const abortController = new AbortController()

    if (messageId) {
      addAbortController(messageId, () => abortController.abort())
    }

    return {
      abortController,
      cleanup: () => {
        if (messageId) {
          removeAbortController(messageId)
        }
      }
    }
  }
}
