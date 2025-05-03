import { REFERENCE_PROMPT } from '@renderer/config/prompts'
import { getLMStudioKeepAliveTime } from '@renderer/hooks/useLMStudio'
import type {
  Assistant,
  GenerateImageParams,
  KnowledgeReference,
  Model,
  Provider,
  Suggestion,
  WebSearchProviderResponse,
  WebSearchResponse
} from '@renderer/types'
import { ChunkType } from '@renderer/types/chunk'
import type { Message } from '@renderer/types/newMessage'
import { delay, isJSON, parseJSON } from '@renderer/utils'
import { addAbortController, removeAbortController } from '@renderer/utils/abortController'
import { formatApiHost } from '@renderer/utils/api'
import { glmZeroPreviewProcessor, thinkTagProcessor, ThoughtProcessor } from '@renderer/utils/formats'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
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
  abstract translate(
    content: string,
    assistant: Assistant,
    onResponse?: (text: string, isComplete: boolean) => void
  ): Promise<string>
  abstract summaries(messages: Message[], assistant: Assistant): Promise<string>
  abstract summaryForSearch(messages: Message[], assistant: Assistant): Promise<string | null>
  abstract suggestions(messages: Message[], assistant: Assistant): Promise<Suggestion[]>
  abstract generateText({ prompt, content }: { prompt: string; content: string }): Promise<string>
  abstract check(model: Model, stream: boolean): Promise<{ valid: boolean; error: Error | null }>
  abstract models(): Promise<OpenAI.Models.Model[]>
  abstract generateImage(params: GenerateImageParams): Promise<string[]>
  abstract generateImageByChat({ messages, assistant, onChunk, onFilterMessages }: CompletionsParams): Promise<void>
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
      'HTTP-Referer': 'https://cherry-ai.com',
      'X-Title': 'Cherry Studio',
      'X-Api-Key': this.apiKey
    }
  }

  public get keepAliveTime() {
    return this.provider.id === 'lmstudio' ? getLMStudioKeepAliveTime() : undefined
  }

  public async fakeCompletions({ onChunk }: CompletionsParams) {
    for (let i = 0; i < 100; i++) {
      await delay(0.01)
      onChunk({
        response: { text: i + '\n', usage: { completion_tokens: 0, prompt_tokens: 0, total_tokens: 0 } },
        type: ChunkType.BLOCK_COMPLETE
      })
    }
  }

  public async getMessageContent(message: Message): Promise<string> {
    const content = getMainTextContent(message)
    if (isEmpty(content)) {
      return ''
    }

    const webSearchReferences = await this.getWebSearchReferencesFromCache(message)
    const knowledgeReferences = await this.getKnowledgeBaseReferencesFromCache(message)

    // 添加偏移量以避免ID冲突
    const reindexedKnowledgeReferences = knowledgeReferences.map((ref) => ({
      ...ref,
      id: ref.id + webSearchReferences.length // 为知识库引用的ID添加网络搜索引用的数量作为偏移量
    }))

    const allReferences = [...webSearchReferences, ...reindexedKnowledgeReferences]

    console.log(`Found ${allReferences.length} references for ID: ${message.id}`, allReferences)

    if (!isEmpty(allReferences)) {
      const referenceContent = `\`\`\`json\n${JSON.stringify(allReferences, null, 2)}\n\`\`\``
      return REFERENCE_PROMPT.replace('{question}', content).replace('{references}', referenceContent)
    }

    return content
  }

  private async getWebSearchReferencesFromCache(message: Message) {
    const content = getMainTextContent(message)
    if (isEmpty(content)) {
      return []
    }
    const webSearch: WebSearchResponse = window.keyv.get(`web-search-${message.id}`)

    if (webSearch) {
      return (webSearch.results as WebSearchProviderResponse).results.map(
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

  /**
   * 从缓存中获取知识库引用
   */
  private async getKnowledgeBaseReferencesFromCache(message: Message): Promise<KnowledgeReference[]> {
    const content = getMainTextContent(message)
    if (isEmpty(content)) {
      return []
    }
    const knowledgeReferences: KnowledgeReference[] = window.keyv.get(`knowledge-search-${message.id}`)

    if (!isEmpty(knowledgeReferences)) {
      // console.log(`Found ${knowledgeReferences.length} knowledge base references in cache for ID: ${message.id}`)
      return knowledgeReferences
    }
    // console.log(`No knowledge base references found in cache for ID: ${message.id}`)
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

  protected createAbortController(messageId?: string, isAddEventListener?: boolean) {
    const abortController = new AbortController()
    const abortFn = () => abortController.abort()

    if (messageId) {
      addAbortController(messageId, abortFn)
    }

    const cleanup = () => {
      if (messageId) {
        signalPromise.resolve?.(undefined)
        removeAbortController(messageId, abortFn)
      }
    }
    const signalPromise: {
      resolve: (value: unknown) => void
      promise: Promise<unknown>
    } = {
      resolve: () => {},
      promise: Promise.resolve()
    }

    if (isAddEventListener) {
      signalPromise.promise = new Promise((resolve, reject) => {
        signalPromise.resolve = resolve
        if (abortController.signal.aborted) {
          reject(new Error('Request was aborted.'))
        }
        // 捕获abort事件,有些abort事件必须
        abortController.signal.addEventListener('abort', () => {
          reject(new Error('Request was aborted.'))
        })
      })
      return {
        abortController,
        cleanup,
        signalPromise
      }
    }
    return {
      abortController,
      cleanup
    }
  }

  /**
   * Finds the appropriate thinking processor for a given text chunk and model.
   * Returns the processor if found, otherwise undefined.
   */
  protected findThinkingProcessor(chunkText: string, model: Model | undefined): ThoughtProcessor | undefined {
    if (!model) return undefined

    const processors: ThoughtProcessor[] = [thinkTagProcessor, glmZeroPreviewProcessor]
    return processors.find((p) => p.canProcess(chunkText, model))
  }

  /**
   * Returns a function closure that handles incremental reasoning text for a specific stream.
   * The returned function processes a chunk, emits THINKING_DELTA for new reasoning,
   * and returns the associated content part.
   */
  protected handleThinkingTags() {
    let memoizedReasoning = ''
    // Returns a function that handles a single chunk potentially containing thinking tags
    return (chunkText: string, processor: ThoughtProcessor, onChunk: (chunk: any) => void): string => {
      // Returns the processed content part
      const { reasoning, content } = processor.process(chunkText)
      let deltaReasoning = ''

      if (reasoning && reasoning.trim()) {
        // Check if the new reasoning starts with the previous one
        if (reasoning.startsWith(memoizedReasoning)) {
          deltaReasoning = reasoning.substring(memoizedReasoning.length)
        } else {
          // If not a continuation, send the whole new reasoning
          deltaReasoning = reasoning
          // console.warn("Thinking content did not start with previous memoized version. Sending full content.")
        }
        memoizedReasoning = reasoning // Update memoized state
      } else {
        // If no reasoning, reset memoized state? Let's reset.
        memoizedReasoning = ''
      }

      if (deltaReasoning) {
        onChunk({ type: ChunkType.THINKING_DELTA, text: deltaReasoning })
      }

      return content // Return the content part for TEXT_DELTA emission
    }
  }
}
