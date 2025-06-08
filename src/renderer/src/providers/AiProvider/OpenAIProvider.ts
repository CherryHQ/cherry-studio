import { isReasoningModel, isSupportedModel, isSupportedThinkingTokenQwenModel } from '@renderer/config/models'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import { getDefaultModel, getTopNamingModel } from '@renderer/services/AssistantService'
import store from '@renderer/store'
import { Assistant, Model, Provider } from '@renderer/types'
import { Message } from '@renderer/types/newMessage'
import { removeSpecialCharactersForTopicName } from '@renderer/utils'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { takeRight } from 'lodash'
import OpenAI from 'openai'
import { ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam } from 'openai/resources'

import BaseProvider from './BaseProvider'

export default class OpenAIProvider extends BaseProvider {
  constructor(provider: Provider) {
    super(provider)
  }

  // /**
  //  * Generate completions for the assistant
  //  * @param params - The completion parameters
  //  * @returns The completions
  //  */
  // async completions(params: CompletionsParams): Promise<CompletionsResult> {
  //   console.log('[OpenAIProvider] completions called with params:', {
  //     messagesCount: params.messages?.length || 0,
  //     streamOutput: params.streamOutput,
  //     assistantId: params.assistant?.id,
  //     modelId: params.assistant?.model?.id
  //   })

  //   try {
  //     console.log('[OpenAIProvider] calling apiClient.completions...')
  //     const result = await this.apiClient.completions(params)
  //     console.log('[OpenAIProvider] apiClient.completions completed successfully')
  //     return result
  //   } catch (error) {
  //     console.error('[OpenAIProvider] apiClient.completions failed:', error)
  //     throw error
  //   }
  // }

  /**
   * Translate a message
   * @param content
   * @param assistant - The assistant
   * @param onResponse - The onResponse callback
   * @returns The translated message
   */
  async translate(content: string, assistant: Assistant, onResponse?: (text: string, isComplete: boolean) => void) {
    const defaultModel = getDefaultModel()
    const model = assistant.model || defaultModel

    const messagesForApi = content
      ? [
          { role: 'system', content: assistant.prompt },
          { role: 'user', content }
        ]
      : [{ role: 'user', content: assistant.prompt }]

    const isSupportedStreamOutput = () => {
      if (!onResponse) {
        return false
      }
      return true
    }

    const stream = isSupportedStreamOutput()

    // 获取SDK实例来直接调用（这些方法暂时保持旧的实现）
    const sdk = await (this.apiClient as any).getSdkInstance()

    if (this.provider.id === 'copilot') {
      const defaultHeaders = store.getState().copilot.defaultHeaders
      const { token } = await window.api.copilot.getToken(defaultHeaders)
      sdk.apiKey = token
    }

    // @ts-ignore key is not typed
    const response = await sdk.chat.completions.create({
      model: model.id,
      messages: messagesForApi as ChatCompletionMessageParam[],
      stream,
      keep_alive: (this.apiClient as any).keepAliveTime,
      temperature: (this.apiClient as any).getTemperature?.(assistant, model),
      top_p: (this.apiClient as any).getTopP?.(assistant, model),
      ...this.getReasoningEffort()
    })

    if (!stream) {
      return response.choices[0].message?.content || ''
    }

    let text = ''
    let isThinking = false
    const isReasoning = isReasoningModel(model)

    for await (const chunk of response) {
      const deltaContent = chunk.choices[0]?.delta?.content || ''

      if (isReasoning) {
        if (deltaContent.includes('<think>')) {
          isThinking = true
        }

        if (!isThinking) {
          text += deltaContent
          onResponse?.(text, false)
        }

        if (deltaContent.includes('</think>')) {
          isThinking = false
        }
      } else {
        text += deltaContent
        onResponse?.(text, false)
      }
    }

    onResponse?.(text, true)

    return text
  }

  /**
   * Get the reasoning effort for the assistant (helper method)
   */
  private getReasoningEffort(): any {
    // 这里可以委托给ApiClient的方法，或者直接返回空对象
    return {}
  }

  /**
   * Summarize a message
   * @param messages - The messages
   * @param assistant - The assistant
   * @returns The summary
   */
  public async summaries(messages: Message[], assistant: Assistant): Promise<string> {
    const model = getTopNamingModel() || assistant.model || getDefaultModel()

    const userMessages = takeRight(messages, 5)
      .filter((message) => !message.isPreset)
      .map((message) => ({
        role: message.role,
        content: getMainTextContent(message)
      }))

    const userMessageContent = userMessages.reduce((prev, curr) => {
      const content = curr.role === 'user' ? `User: ${curr.content}` : `Assistant: ${curr.content}`
      return prev + (prev ? '\n' : '') + content
    }, '')

    const systemMessage = {
      role: 'system',
      content: getStoreSetting('topicNamingPrompt') || i18n.t('prompts.title')
    }

    const userMessage = {
      role: 'user',
      content: userMessageContent
    }

    const sdk = await (this.apiClient as any).getSdkInstance()

    if (this.provider.id === 'copilot') {
      const defaultHeaders = store.getState().copilot.defaultHeaders
      const { token } = await window.api.copilot.getToken(defaultHeaders)
      sdk.apiKey = token
    }

    // @ts-ignore key is not typed
    const response = await sdk.chat.completions.create({
      model: model.id,
      messages: [systemMessage, userMessage] as ChatCompletionMessageParam[],
      stream: false,
      keep_alive: (this.apiClient as any).keepAliveTime,
      max_tokens: 1000
    })

    // 针对思考类模型的返回，总结仅截取</think>之后的内容
    let content = response.choices[0].message?.content || ''
    content = content.replace(/^<think>(.*?)<\/think>/s, '')

    return removeSpecialCharactersForTopicName(content.substring(0, 50))
  }

  /**
   * Summarize a message for search
   * @param messages - The messages
   * @param assistant - The assistant
   * @returns The summary
   */
  public async summaryForSearch(messages: Message[], assistant: Assistant): Promise<string | null> {
    const model = assistant.model || getDefaultModel()

    const systemMessage = {
      role: 'system',
      content: assistant.prompt
    }

    const messageContents = messages.map((m) => getMainTextContent(m))
    const userMessageContent = messageContents.join('\n')

    const userMessage = {
      role: 'user',
      content: userMessageContent
    }

    const sdk = await (this.apiClient as any).getSdkInstance()

    if (this.provider.id === 'copilot') {
      const defaultHeaders = store.getState().copilot.defaultHeaders
      const { token } = await window.api.copilot.getToken(defaultHeaders)
      sdk.apiKey = token
    }

    // 创建AbortController（简化版）
    const abortController = new AbortController()
    const { signal } = abortController

    const response = await sdk.chat.completions
      // @ts-ignore key is not typed
      .create(
        {
          model: model.id,
          messages: [systemMessage, userMessage] as ChatCompletionMessageParam[],
          stream: false,
          keep_alive: (this.apiClient as any).keepAliveTime,
          max_tokens: 1000
        },
        {
          timeout: 20 * 1000,
          signal: signal
        }
      )

    // 针对思考类模型的返回，总结仅截取</think>之后的内容
    let content = response.choices[0].message?.content || ''
    content = content.replace(/^<think>(.*?)<\/think>/s, '')

    return content
  }

  /**
   * Generate text
   * @param prompt - The prompt
   * @param content - The content
   * @returns The generated text
   */
  public async generateText({ prompt, content }: { prompt: string; content: string }): Promise<string> {
    const model = getDefaultModel()
    const sdk = await (this.apiClient as any).getSdkInstance()

    if (this.provider.id === 'copilot') {
      const defaultHeaders = store.getState().copilot.defaultHeaders
      const { token } = await window.api.copilot.getToken(defaultHeaders)
      sdk.apiKey = token
    }

    const response = await sdk.chat.completions.create({
      model: model.id,
      stream: false,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content }
      ]
    })

    return response.choices[0].message?.content || ''
  }

  // /**
  //  * Generate suggestions
  //  * @param messages - The messages
  //  * @param assistant - The assistant
  //  * @returns The suggestions
  //  */
  // async suggestions(messages: Message[], assistant: Assistant): Promise<Suggestion[]> {
  //   const { model } = assistant

  //   if (!model) {
  //     return []
  //   }

  //   const sdk = await (this.apiClient as any).getSdkInstance()

  //   if (this.provider.id === 'copilot') {
  //     const defaultHeaders = store.getState().copilot.defaultHeaders
  //     const { token } = await window.api.copilot.getToken(defaultHeaders)
  //     sdk.apiKey = token
  //   }

  //   const userMessagesForApi = messages
  //     .filter((m) => m.role === 'user')
  //     .map((m) => ({
  //       role: m.role,
  //       content: getMainTextContent(m)
  //     }))

  //   const response: any = await sdk.request({
  //     method: 'post',
  //     path: '/advice_questions',
  //     body: {
  //       messages: userMessagesForApi,
  //       model: model.id,
  //       max_tokens: 0,
  //       temperature: 0,
  //       n: 0
  //     }
  //   })

  //   return response?.questions?.filter(Boolean)?.map((q: any) => ({ content: q })) || []
  // }

  /**
   * Check if the model is valid
   * @param model - The model
   * @param stream - Whether to use streaming interface
   * @returns The validity of the model
   */
  public async check(model: Model, stream: boolean = false): Promise<{ valid: boolean; error: Error | null }> {
    if (!model) {
      return { valid: false, error: new Error('No model found') }
    }

    const body: any = {
      model: model.id,
      messages: [{ role: 'user', content: 'hi' }],
      stream
    }

    if (isSupportedThinkingTokenQwenModel(model)) {
      body.enable_thinking = false // qwen3
    }

    try {
      const sdk = await (this.apiClient as any).getSdkInstance()

      if (this.provider.id === 'copilot') {
        const defaultHeaders = store.getState().copilot.defaultHeaders
        const { token } = await window.api.copilot.getToken(defaultHeaders)
        sdk.apiKey = token
      }

      if (!stream) {
        const response = await sdk.chat.completions.create(body as ChatCompletionCreateParamsNonStreaming)
        if (!response?.choices[0].message) {
          throw new Error('Empty response')
        }
        return { valid: true, error: null }
      } else {
        const response: any = await sdk.chat.completions.create(body as any)
        // 等待整个流式响应结束
        let hasContent = false
        for await (const chunk of response) {
          if (chunk.choices?.[0]?.delta?.content) {
            hasContent = true
          }
        }
        if (hasContent) {
          return { valid: true, error: null }
        }
        throw new Error('Empty streaming response')
      }
    } catch (error: any) {
      return {
        valid: false,
        error
      }
    }
  }

  /**
   * Get the models
   * @returns The models
   */
  public async models(): Promise<OpenAI.Models.Model[]> {
    try {
      const sdk = await (this.apiClient as any).getSdkInstance()

      if (this.provider.id === 'copilot') {
        const defaultHeaders = store.getState().copilot.defaultHeaders
        const { token } = await window.api.copilot.getToken(defaultHeaders)
        sdk.apiKey = token
      }

      const response = await sdk.models.list()

      if (this.provider.id === 'github') {
        // @ts-ignore key is not typed
        return response.body
          .map((model) => ({
            id: model.name,
            description: model.summary,
            object: 'model',
            owned_by: model.publisher
          }))
          .filter(isSupportedModel)
      }

      if (this.provider.id === 'together') {
        // @ts-ignore key is not typed
        return response?.body
          .map((model: any) => ({
            id: model.id,
            description: model.display_name,
            object: 'model',
            owned_by: model.organization
          }))
          .filter(isSupportedModel)
      }

      const models = response.data || []
      models.forEach((model) => {
        model.id = model.id.trim()
      })

      return models.filter(isSupportedModel)
    } catch (error) {
      return []
    }
  }

  /**
   * Get the embedding dimensions
   * @param model - The model
   * @returns The embedding dimensions
   */
  public async getEmbeddingDimensions(model: Model): Promise<number> {
    const sdk = await (this.apiClient as any).getSdkInstance()

    if (this.provider.id === 'copilot') {
      const defaultHeaders = store.getState().copilot.defaultHeaders
      const { token } = await window.api.copilot.getToken(defaultHeaders)
      sdk.apiKey = token
    }

    try {
      const data = await sdk.embeddings.create({
        model: model.id,
        input: model?.provider === 'baidu-cloud' ? ['hi'] : 'hi',
        encoding_format: 'float'
      })
      return data.data[0].embedding.length
    } catch (e) {
      return 0
    }
  }

  // 占位符方法，需要根据具体需求实现
  async generateImage(): Promise<string[]> {
    throw new Error('generateImage not implemented')
  }

  async generateImageByChat(): Promise<void> {
    throw new Error('generateImageByChat not implemented')
  }

  async getMessageParam(): Promise<any> {
    throw new Error('getMessageParam not implemented')
  }
}
