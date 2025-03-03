import { DEFAULT_MAX_TOKENS } from '@renderer/config/constant'
import {
  getOpenAIWebSearchParams,
  isOpenAIoSeries,
  isReasoningModel,
  isSupportedModel,
  isVisionModel
} from '@renderer/config/models'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import { getAssistantSettings, getDefaultModel, getTopNamingModel } from '@renderer/services/AssistantService'
import { EVENT_NAMES } from '@renderer/services/EventService'
import { filterContextMessages } from '@renderer/services/MessagesService'
import { Assistant, FileTypes, GenerateImageParams, Message, Model, Provider, Suggestion } from '@renderer/types'
import { removeSpecialCharacters } from '@renderer/utils'
import { takeRight } from 'lodash'
import OpenAI, { AzureOpenAI } from 'openai'
import {
  ChatCompletionContentPart,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam
} from 'openai/resources'

import { CompletionsParams } from '.'
import BaseProvider from './BaseProvider'

type ReasoningEffort = 'high' | 'medium' | 'low'

export default class OpenAIProvider extends BaseProvider {
  private sdk: OpenAI

  constructor(provider: Provider) {
    super(provider)

    if (provider.id === 'azure-openai' || provider.type === 'azure-openai') {
      this.sdk = new AzureOpenAI({
        dangerouslyAllowBrowser: true,
        apiKey: this.apiKey,
        apiVersion: provider.apiVersion,
        endpoint: provider.apiHost
      })
      return
    }

    this.sdk = new OpenAI({
      dangerouslyAllowBrowser: true,
      apiKey: this.apiKey,
      baseURL: this.getBaseURL(),
      defaultHeaders: {
        ...this.defaultHeaders(),
        ...(this.provider.id === 'copilot' ? { 'editor-version': 'vscode/1.97.2' } : {})
      }
    })
  }

  private get isNotSupportFiles() {
    const providers = ['deepseek', 'baichuan', 'minimax', 'doubao', 'xirang']
    return providers.includes(this.provider.id)
  }

  private async getMessageParam(
    message: Message,
    model: Model
  ): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam> {
    const isVision = isVisionModel(model)
    const content = await this.getMessageContent(message)

    if (!message.files) {
      return {
        role: message.role,
        content
      }
    }

    if (this.isNotSupportFiles) {
      if (message.files) {
        const textFiles = message.files.filter((file) => [FileTypes.TEXT, FileTypes.DOCUMENT].includes(file.type))

        if (textFiles.length > 0) {
          let text = ''
          const divider = '\n\n---\n\n'

          for (const file of textFiles) {
            const fileContent = (await window.api.file.read(file.id + file.ext)).trim()
            const fileNameRow = 'file: ' + file.origin_name + '\n\n'
            text = text + fileNameRow + fileContent + divider
          }

          return {
            role: message.role,
            content: content + divider + text
          }
        }
      }

      return {
        role: message.role,
        content
      }
    }

    const parts: ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: content
      }
    ]

    for (const file of message.files || []) {
      if (file.type === FileTypes.IMAGE && isVision) {
        const image = await window.api.file.base64Image(file.id + file.ext)
        parts.push({
          type: 'image_url',
          image_url: { url: image.data }
        })
      }
      if ([FileTypes.TEXT, FileTypes.DOCUMENT].includes(file.type)) {
        const fileContent = await (await window.api.file.read(file.id + file.ext)).trim()
        parts.push({
          type: 'text',
          text: file.origin_name + '\n' + fileContent
        })
      }
    }

    return {
      role: message.role,
      content: parts
    } as ChatCompletionMessageParam
  }

  private getTemperature(assistant: Assistant, model: Model) {
    if (isReasoningModel(model)) return undefined

    return assistant?.settings?.temperature
  }

  private getProviderSpecificParameters(assistant: Assistant, model: Model) {
    const { maxTokens } = getAssistantSettings(assistant)

    if (this.provider.id === 'openrouter') {
      if (model.id.includes('deepseek-r1')) {
        return {
          include_reasoning: true
        }
      }
    }

    if (this.isOpenAIo1(model)) {
      return {
        max_tokens: undefined,
        max_completion_tokens: maxTokens
      }
    }

    return {}
  }

  private getTopP(assistant: Assistant, model: Model) {
    if (isReasoningModel(model)) return undefined

    return assistant?.settings?.topP
  }

  private getReasoningEffort(assistant: Assistant, model: Model) {
    if (this.provider.id === 'groq') {
      return {}
    }

    if (isReasoningModel(model)) {
      if (model.provider === 'openrouter') {
        return {
          reasoning: {
            effort: assistant?.settings?.reasoning_effort
          }
        }
      }

      if (isOpenAIoSeries(model)) {
        return {
          reasoning_effort: assistant?.settings?.reasoning_effort
        }
      }

      if (model.id.includes('claude-3.7-sonnet') || model.id.includes('claude-3-7-sonnet')) {
        const effortRatios: Record<ReasoningEffort, number> = {
          high: 0.8,
          medium: 0.5,
          low: 0.2
        }

        const effort = assistant?.settings?.reasoning_effort as ReasoningEffort
        const effortRatio = effortRatios[effort]

        if (!effortRatio) {
          return {}
        }

        const maxTokens = assistant?.settings?.maxTokens || DEFAULT_MAX_TOKENS
        const budgetTokens = Math.trunc(Math.max(Math.min(maxTokens * effortRatio, 32000), 1024))

        return {
          thinking: {
            budget_tokens: budgetTokens
          }
        }
      }

      return {}
    }

    return {}
  }

  private isOpenAIo1(model: Model) {
    return model.id.startsWith('o1')
  }

  async completions({ messages, assistant, onChunk, onFilterMessages }: CompletionsParams): Promise<void> {
    const defaultModel = getDefaultModel()
    const model = assistant.model || defaultModel
    const { contextCount, maxTokens, streamOutput } = getAssistantSettings(assistant)

    let systemMessage = assistant.prompt ? { role: 'system', content: assistant.prompt } : undefined

    if (isOpenAIoSeries(model)) {
      systemMessage = {
        role: 'developer',
        content: `Formatting re-enabled${systemMessage ? '\n' + systemMessage.content : ''}`
      }
    }

    const userMessages: ChatCompletionMessageParam[] = []

    const _messages = filterContextMessages(takeRight(messages, contextCount + 1))
    onFilterMessages(_messages)

    if (model.id === 'deepseek-reasoner') {
      if (_messages[0]?.role !== 'user') {
        userMessages.push({ role: 'user', content: '' })
      }
    }

    for (const message of _messages) {
      userMessages.push(await this.getMessageParam(message, model))
    }

    const isOpenAIo1 = this.isOpenAIo1(model)

    const isSupportStreamOutput = () => {
      if (isOpenAIo1) {
        return false
      }
      return streamOutput
    }

    let hasReasoningContent = false
    let lastChunk = ''
    const isReasoningJustDone = (
      delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta & {
        reasoning_content?: string
        reasoning?: string
        thinking?: string
      }
    ) => {
      if (!delta?.content) return false

      // 检查当前chunk和上一个chunk的组合是否形成###Response标记
      const combinedChunks = lastChunk + delta.content
      lastChunk = delta.content

      // 检测思考结束
      if (combinedChunks.includes('###Response') || delta.content === '</think>') {
        return true
      }

      // 如果有reasoning_content或reasoning，说明是在思考中
      if (delta?.reasoning_content || delta?.reasoning || delta?.thinking) {
        hasReasoningContent = true
      }

      // 如果之前有reasoning_content或reasoning，现在有普通content，说明思考结束
      if (hasReasoningContent && delta.content) {
        return true
      }

      return false
    }

    let time_first_token_millsec = 0
    let time_first_content_millsec = 0
    const start_time_millsec = new Date().getTime()
    const lastUserMessage = _messages.findLast((m) => m.role === 'user')
    const { abortController, cleanup } = this.createAbortController(lastUserMessage?.id)
    const { signal } = abortController
    await this.checkIsCopilot()

    const stream = await this.sdk.chat.completions
      // @ts-ignore key is not typed
      .create(
        {
          model: model.id,
          messages: [systemMessage, ...userMessages].filter(Boolean) as ChatCompletionMessageParam[],
          temperature: this.getTemperature(assistant, model),
          top_p: this.getTopP(assistant, model),
          max_tokens: maxTokens,
          keep_alive: this.keepAliveTime,
          stream: isSupportStreamOutput(),
          ...getOpenAIWebSearchParams(assistant, model),
          ...this.getReasoningEffort(assistant, model),
          ...this.getProviderSpecificParameters(assistant, model),
          ...this.getCustomParameters(assistant)
        },
        {
          signal
        }
      )
      .finally(cleanup)

    if (!isSupportStreamOutput()) {
      const time_completion_millsec = new Date().getTime() - start_time_millsec
      return onChunk({
        text: stream.choices[0].message?.content || '',
        usage: stream.usage,
        metrics: {
          completion_tokens: stream.usage?.completion_tokens,
          time_completion_millsec,
          time_first_token_millsec: 0
        }
      })
    }

    // @ts-expect-error `stream` is not typed
    for await (const chunk of stream) {
      if (window.keyv.get(EVENT_NAMES.CHAT_COMPLETION_PAUSED)) {
        break
      }

      const delta = chunk.choices[0]?.delta

      if (delta?.reasoning_content || delta?.reasoning) {
        hasReasoningContent = true
      }

      if (time_first_token_millsec == 0) {
        time_first_token_millsec = new Date().getTime() - start_time_millsec
      }

      if (time_first_content_millsec == 0 && isReasoningJustDone(delta)) {
        time_first_content_millsec = new Date().getTime()
      }

      const time_completion_millsec = new Date().getTime() - start_time_millsec
      const time_thinking_millsec = time_first_content_millsec ? time_first_content_millsec - start_time_millsec : 0

      // Extract citations from the raw response if available
      const citations = (chunk as OpenAI.Chat.Completions.ChatCompletionChunk & { citations?: string[] })?.citations

      onChunk({
        text: delta?.content || '',
        // @ts-ignore key is not typed
        reasoning_content: delta?.reasoning_content || delta?.reasoning || '',
        usage: chunk.usage,
        metrics: {
          completion_tokens: chunk.usage?.completion_tokens,
          time_completion_millsec,
          time_first_token_millsec,
          time_thinking_millsec
        },
        citations
      })
    }
  }

  async translate(message: Message, assistant: Assistant, onResponse?: (text: string) => void) {
    const defaultModel = getDefaultModel()
    const model = assistant.model || defaultModel
    const messages = message.content
      ? [
          { role: 'system', content: assistant.prompt },
          { role: 'user', content: message.content }
        ]
      : [{ role: 'user', content: assistant.prompt }]

    const isOpenAIo1 = this.isOpenAIo1(model)

    const isSupportedStreamOutput = () => {
      if (!onResponse) {
        return false
      }
      if (isOpenAIo1) {
        return false
      }
      return true
    }

    const stream = isSupportedStreamOutput()

    await this.checkIsCopilot()

    // @ts-ignore key is not typed
    const response = await this.sdk.chat.completions.create({
      model: model.id,
      messages: messages as ChatCompletionMessageParam[],
      stream,
      keep_alive: this.keepAliveTime,
      temperature: assistant?.settings?.temperature
    })

    if (!stream) {
      return response.choices[0].message?.content || ''
    }

    let text = ''

    for await (const chunk of response) {
      text += chunk.choices[0]?.delta?.content || ''
      onResponse?.(text)
    }

    return text
  }

  public async summaries(messages: Message[], assistant: Assistant): Promise<string> {
    const model = getTopNamingModel() || assistant.model || getDefaultModel()

    const userMessages = takeRight(messages, 5)
      .filter((message) => !message.isPreset)
      .map((message) => ({
        role: message.role,
        content: message.content
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

    await this.checkIsCopilot()

    // @ts-ignore key is not typed
    const response = await this.sdk.chat.completions.create({
      model: model.id,
      messages: [systemMessage, userMessage] as ChatCompletionMessageParam[],
      stream: false,
      keep_alive: this.keepAliveTime,
      max_tokens: 1000
    })

    // 针对思考类模型的返回，总结仅截取</think>之后的内容
    let content = response.choices[0].message?.content || ''
    content = content.replace(/^<think>(.*?)<\/think>/s, '')

    return removeSpecialCharacters(content.substring(0, 50))
  }

  public async generateText({ prompt, content }: { prompt: string; content: string }): Promise<string> {
    const model = getDefaultModel()

    await this.checkIsCopilot()

    const response = await this.sdk.chat.completions.create({
      model: model.id,
      stream: false,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content }
      ]
    })

    return response.choices[0].message?.content || ''
  }

  async suggestions(messages: Message[], assistant: Assistant): Promise<Suggestion[]> {
    const model = assistant.model

    if (!model) {
      return []
    }

    await this.checkIsCopilot()

    const response: any = await this.sdk.request({
      method: 'post',
      path: '/advice_questions',
      body: {
        messages: messages.filter((m) => m.role === 'user').map((m) => ({ role: m.role, content: m.content })),
        model: model.id,
        max_tokens: 0,
        temperature: 0,
        n: 0
      }
    })

    return response?.questions?.filter(Boolean)?.map((q: any) => ({ content: q })) || []
  }

  public async check(model: Model): Promise<{ valid: boolean; error: Error | null }> {
    if (!model) {
      return { valid: false, error: new Error('No model found') }
    }
    const body = {
      model: model.id,
      messages: [{ role: 'user', content: 'hi' }],
      stream: false
    }

    try {
      await this.checkIsCopilot()
      const response = await this.sdk.chat.completions.create(body as ChatCompletionCreateParamsNonStreaming)

      return {
        valid: Boolean(response?.choices[0].message),
        error: null
      }
    } catch (error: any) {
      return {
        valid: false,
        error
      }
    }
  }

  public async models(): Promise<OpenAI.Models.Model[]> {
    try {
      await this.checkIsCopilot()

      const response = await this.sdk.models.list()

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

      const models = response?.data || []

      return models.filter(isSupportedModel)
    } catch (error) {
      return []
    }
  }

  public async generateImage({
    model,
    prompt,
    negativePrompt,
    imageSize,
    batchSize,
    seed,
    numInferenceSteps,
    guidanceScale,
    signal,
    promptEnhancement
  }: GenerateImageParams): Promise<string[]> {
    await this.checkIsCopilot()

    const response = (await this.sdk.request({
      method: 'post',
      path: '/images/generations',
      signal,
      body: {
        model,
        prompt,
        negative_prompt: negativePrompt,
        image_size: imageSize,
        batch_size: batchSize,
        seed: seed ? parseInt(seed) : undefined,
        num_inference_steps: numInferenceSteps,
        guidance_scale: guidanceScale,
        prompt_enhancement: promptEnhancement
      }
    })) as { data: Array<{ url: string }> }

    return response.data.map((item) => item.url)
  }

  public async getEmbeddingDimensions(model: Model): Promise<number> {
    await this.checkIsCopilot()

    const data = await this.sdk.embeddings.create({
      model: model.id,
      input: model?.provider === 'baidu-cloud' ? ['hi'] : 'hi'
    })
    return data.data[0].embedding.length
  }

  public async checkIsCopilot() {
    if (this.provider.id !== 'copilot') return

    // copilot每次请求前需要重新获取token，因为token中附带时间戳
    const { token } = await window.api.copilot.getToken()
    this.sdk.apiKey = token
  }
}
