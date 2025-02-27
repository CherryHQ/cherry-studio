import Anthropic from '@anthropic-ai/sdk'
import { MessageCreateParamsNonStreaming, MessageParam } from '@anthropic-ai/sdk/resources'
import { DEFAULT_MAX_TOKENS } from '@renderer/config/constant'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import { getAssistantSettings, getDefaultModel, getTopNamingModel } from '@renderer/services/AssistantService'
import { EVENT_NAMES } from '@renderer/services/EventService'
import { filterContextMessages } from '@renderer/services/MessagesService'
import { Assistant, FileTypes, Message, Model, Provider, Suggestion } from '@renderer/types'
import { removeSpecialCharacters } from '@renderer/utils'
import { first, flatten, sum, takeRight } from 'lodash'
import OpenAI from 'openai'

import { CompletionsParams } from '.'
import BaseProvider from './BaseProvider'
export default class AnthropicProvider extends BaseProvider {
  private sdk: Anthropic

  constructor(provider: Provider) {
    super(provider)
    this.sdk = new Anthropic({
      apiKey: this.apiKey,
      baseURL: this.getBaseURL(),
      dangerouslyAllowBrowser: true
    })
  }

  public getBaseURL(): string {
    return this.provider.apiHost
  }

  private async getMessageParam(message: Message): Promise<MessageParam> {
    const parts: MessageParam['content'] = [
      {
        type: 'text',
        text: await this.getMessageContent(message)
      }
    ]

    for (const file of message.files || []) {
      if (file.type === FileTypes.IMAGE) {
        const base64Data = await window.api.file.base64Image(file.id + file.ext)
        parts.push({
          type: 'image',
          source: {
            data: base64Data.base64,
            media_type: base64Data.mime.replace('jpg', 'jpeg') as any,
            type: 'base64'
          }
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
    }
  }

  public async completions({ messages, assistant, onChunk, onFilterMessages }: CompletionsParams) {
    const defaultModel = getDefaultModel()
    const model = assistant.model || defaultModel
    const { contextCount, maxTokens, streamOutput, enableThinking } = getAssistantSettings(assistant)

    const userMessagesParams: MessageParam[] = []
    const _messages = filterContextMessages(takeRight(messages, contextCount + 2))

    onFilterMessages(_messages)

    for (const message of _messages) {
      userMessagesParams.push(await this.getMessageParam(message))
    }

    const userMessages = flatten(userMessagesParams)

    if (first(userMessages)?.role === 'assistant') {
      userMessages.shift()
    }

    const body: MessageCreateParamsNonStreaming = {
      model: model.id,
      messages: userMessages,
      max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
      temperature: assistant?.settings?.temperature,
      top_p: assistant?.settings?.topP,
      system: assistant.prompt,
      ...this.getCustomParameters(assistant)
    }

    // 添加思考参数
    if (enableThinking) {
      ;(body as any).thinking = {
        type: 'enabled',
        budget_tokens: 2048
      }
    }

    let time_first_token_millsec = 0
    let time_first_content_millsec = 0
    const start_time_millsec = new Date().getTime()

    if (!streamOutput) {
      const message = await this.sdk.messages.create({ ...body, stream: false })
      const time_completion_millsec = new Date().getTime() - start_time_millsec

      // 处理非流式输出的思考内容
      let text = ''
      let reasoning_content = ''

      if (message.content && message.content.length > 0) {
        // 检查是否有思考内容
        const thinkingBlock = message.content.find((block) => block.type === 'thinking')
        const textBlock = message.content.find((block) => block.type === 'text')

        if (thinkingBlock && 'thinking' in thinkingBlock) {
          reasoning_content = thinkingBlock.thinking
        }

        if (textBlock && 'text' in textBlock) {
          text = textBlock.text
        }
      }

      return onChunk({
        text,
        reasoning_content,
        usage: message.usage,
        metrics: {
          completion_tokens: message.usage.output_tokens,
          time_completion_millsec,
          time_first_token_millsec: 0
        }
      })
    }

    const lastUserMessage = _messages.findLast((m) => m.role === 'user')

    const { abortController, cleanup } = this.createAbortController(lastUserMessage?.id)
    const { signal } = abortController

    return new Promise<void>((resolve, reject) => {
      let hasThinkingContent = false

      const stream = this.sdk.messages
        .stream({ ...body, stream: true }, { signal })
        .on('text', (text) => {
          if (window.keyv.get(EVENT_NAMES.CHAT_COMPLETION_PAUSED)) {
            stream.controller.abort()
            return resolve()
          }
          if (time_first_token_millsec == 0) {
            time_first_token_millsec = new Date().getTime() - start_time_millsec
          }

          // 如果之前有思考内容，现在有文本内容，记录思考结束时间
          if (hasThinkingContent && time_first_content_millsec === 0) {
            time_first_content_millsec = new Date().getTime()
          }

          const time_completion_millsec = new Date().getTime() - start_time_millsec
          const time_thinking_millsec = time_first_content_millsec ? time_first_content_millsec - start_time_millsec : 0

          onChunk({
            text,
            metrics: {
              completion_tokens: undefined,
              time_completion_millsec,
              time_first_token_millsec,
              time_thinking_millsec
            }
          })
        })
        .on('thinking', (thinking) => {
          hasThinkingContent = true

          if (time_first_token_millsec == 0) {
            time_first_token_millsec = new Date().getTime() - start_time_millsec
          }

          const time_completion_millsec = new Date().getTime() - start_time_millsec

          onChunk({
            reasoning_content: thinking,
            text: '',
            metrics: {
              completion_tokens: undefined,
              time_completion_millsec,
              time_first_token_millsec
            }
          })
        })
        .on('finalMessage', (message) => {
          const time_completion_millsec = new Date().getTime() - start_time_millsec
          const time_thinking_millsec = time_first_content_millsec ? time_first_content_millsec - start_time_millsec : 0

          onChunk({
            text: '',
            usage: {
              prompt_tokens: message.usage.input_tokens,
              completion_tokens: message.usage.output_tokens,
              total_tokens: sum(Object.values(message.usage))
            },
            metrics: {
              completion_tokens: message.usage.output_tokens,
              time_completion_millsec,
              time_first_token_millsec,
              time_thinking_millsec
            }
          })
          resolve()
        })
        .on('error', (error) => reject(error))
    }).finally(cleanup)
  }

  public async translate(message: Message, assistant: Assistant, onResponse?: (text: string) => void) {
    const defaultModel = getDefaultModel()
    const model = assistant.model || defaultModel
    const messages = [
      { role: 'system', content: assistant.prompt },
      { role: 'user', content: message.content }
    ]

    const stream = onResponse ? true : false

    const body: MessageCreateParamsNonStreaming = {
      model: model.id,
      messages: messages.filter((m) => m.role === 'user') as MessageParam[],
      max_tokens: 4096,
      temperature: assistant?.settings?.temperature,
      system: assistant.prompt
    }

    if (!stream) {
      const response = await this.sdk.messages.create({ ...body, stream: false })
      return response.content[0].type === 'text' ? response.content[0].text : ''
    }

    let text = ''

    return new Promise<string>((resolve, reject) => {
      this.sdk.messages
        .stream({ ...body, stream: true })
        .on('text', (_text) => {
          text += _text
          onResponse?.(text)
        })
        .on('finalMessage', () => resolve(text))
        .on('error', (error) => reject(error))
    })
  }

  public async summaries(messages: Message[], assistant: Assistant): Promise<string> {
    const model = getTopNamingModel() || assistant.model || getDefaultModel()

    const userMessages = takeRight(messages, 5)
      .filter((message) => !message.isPreset)
      .map((message) => ({
        role: message.role,
        content: message.content
      }))

    if (first(userMessages)?.role === 'assistant') {
      userMessages.shift()
    }

    const userMessageContent = userMessages.reduce((prev, curr) => {
      const content = curr.role === 'user' ? `User: ${curr.content}` : `Assistant: ${curr.content}`
      return prev + (prev ? '\n' : '') + content
    }, '')

    const systemMessage = {
      role: 'system',
      content: (getStoreSetting('topicNamingPrompt') as string) || i18n.t('prompts.title')
    }

    const userMessage = {
      role: 'user',
      content: userMessageContent
    }

    const message = await this.sdk.messages.create({
      messages: [userMessage] as Anthropic.Messages.MessageParam[],
      model: model.id,
      system: systemMessage.content,
      stream: false,
      max_tokens: 4096
    })

    const content = message.content[0].type === 'text' ? message.content[0].text : ''

    return removeSpecialCharacters(content)
  }

  public async generateText({ prompt, content }: { prompt: string; content: string }): Promise<string> {
    const model = getDefaultModel()

    const message = await this.sdk.messages.create({
      model: model.id,
      system: prompt,
      stream: false,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content
        }
      ]
    })

    return message.content[0].type === 'text' ? message.content[0].text : ''
  }

  public async generateImage(): Promise<string[]> {
    return []
  }

  public async suggestions(): Promise<Suggestion[]> {
    return []
  }

  public async check(model: Model): Promise<{ valid: boolean; error: Error | null }> {
    if (!model) {
      return { valid: false, error: new Error('No model found') }
    }

    const body = {
      model: model.id,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 100,
      stream: false
    }

    try {
      const message = await this.sdk.messages.create(body as MessageCreateParamsNonStreaming)
      return {
        valid: message.content.length > 0,
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
    return []
  }

  public async getEmbeddingDimensions(): Promise<number> {
    return 0
  }
}
