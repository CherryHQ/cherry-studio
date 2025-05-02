import Anthropic from '@anthropic-ai/sdk'
import { MessageCreateParamsNonStreaming, MessageParam, TextBlockParam } from '@anthropic-ai/sdk/resources'
import { DEFAULT_MAX_TOKENS } from '@renderer/config/constant'
import { isReasoningModel, isVisionModel } from '@renderer/config/models'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import { getAssistantSettings, getDefaultModel, getTopNamingModel } from '@renderer/services/AssistantService'
import {
  filterContextMessages,
  filterEmptyMessages,
  filterUserRoleStartMessages
} from '@renderer/services/MessagesService'
import { Assistant, EFFORT_RATIO, FileTypes, MCPToolResponse, Model, Provider, Suggestion } from '@renderer/types'
import { ChunkType } from '@renderer/types/chunk'
import type { Message } from '@renderer/types/newMessage'
import { removeSpecialCharactersForTopicName } from '@renderer/utils'
import { mcpToolCallResponseToAnthropicMessage, parseAndCallTools } from '@renderer/utils/mcp-tools'
import { findFileBlocks, findImageBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { buildSystemPrompt } from '@renderer/utils/prompt'
import { first, flatten, sum, takeRight } from 'lodash'
import OpenAI from 'openai'

import { CompletionsParams } from '.'
import BaseProvider from './BaseProvider'

interface ReasoningConfig {
  type: 'enabled' | 'disabled'
  budget_tokens?: number
}

export default class AnthropicProvider extends BaseProvider {
  private sdk: Anthropic

  constructor(provider: Provider) {
    super(provider)
    this.sdk = new Anthropic({
      apiKey: this.apiKey,
      baseURL: this.getBaseURL(),
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
        'anthropic-beta': 'output-128k-2025-02-19'
      }
    })
  }

  public getBaseURL(): string {
    return this.provider.apiHost
  }

  /**
   * Get the message parameter
   * @param message - The message
   * @returns The message parameter
   */
  private async getMessageParam(message: Message): Promise<MessageParam> {
    const parts: MessageParam['content'] = [
      {
        type: 'text',
        text: getMainTextContent(message)
      }
    ]

    // Get and process image blocks
    const imageBlocks = findImageBlocks(message)
    for (const imageBlock of imageBlocks) {
      if (imageBlock.file) {
        // Handle uploaded file
        const file = imageBlock.file
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

      // Get and process file blocks
      const fileBlocks = findFileBlocks(message)
      for (const fileBlock of fileBlocks) {
        const file = fileBlock.file
        if ([FileTypes.TEXT, FileTypes.DOCUMENT].includes(file.type)) {
          const fileContent = await (await window.api.file.read(file.id + file.ext)).trim()
          parts.push({
            type: 'text',
            text: file.origin_name + '\n' + fileContent
          })
        }
      }
    }
    return {
      role: message.role === 'system' ? 'user' : message.role,
      content: parts
    }
  }

  /**
   * Get the temperature
   * @param assistant - The assistant
   * @param model - The model
   * @returns The temperature
   */
  private getTemperature(assistant: Assistant, model: Model) {
    return isReasoningModel(model) ? undefined : assistant?.settings?.temperature
  }

  /**
   * Get the top P
   * @param assistant - The assistant
   * @param model - The model
   * @returns The top P
   */
  private getTopP(assistant: Assistant, model: Model) {
    return isReasoningModel(model) ? undefined : assistant?.settings?.topP
  }

  /**
   * Get the reasoning effort
   * @param assistant - The assistant
   * @param model - The model
   * @returns The reasoning effort
   */
  private getBudgetToken(assistant: Assistant, model: Model): ReasoningConfig | undefined {
    if (!isReasoningModel(model)) {
      return undefined
    }
    const { maxTokens } = getAssistantSettings(assistant)

    const reasoningEffort = assistant?.settings?.reasoning_effort

    if (reasoningEffort === undefined) {
      return {
        type: 'disabled'
      }
    }

    const effortRatio = EFFORT_RATIO[reasoningEffort]

    const budgetTokens = Math.floor((maxTokens || DEFAULT_MAX_TOKENS) * effortRatio * 0.8)

    return {
      type: 'enabled',
      budget_tokens: budgetTokens
    }
  }

  /**
   * Generate completions
   * @param messages - The messages
   * @param assistant - The assistant
   * @param mcpTools - The MCP tools
   * @param onChunk - The onChunk callback
   * @param onFilterMessages - The onFilterMessages callback
   */
  public async completions({ messages, assistant, mcpTools, onChunk, onFilterMessages }: CompletionsParams) {
    const defaultModel = getDefaultModel()
    const model = assistant.model || defaultModel
    const { contextCount, maxTokens, streamOutput } = getAssistantSettings(assistant)

    const userMessagesParams: MessageParam[] = []

    const _messages = filterUserRoleStartMessages(
      filterContextMessages(filterEmptyMessages(takeRight(messages, contextCount + 2)))
    )

    onFilterMessages(_messages)

    for (const message of _messages) {
      userMessagesParams.push(await this.getMessageParam(message))
    }

    const userMessages = flatten(userMessagesParams)
    const lastUserMessage = _messages.findLast((m) => m.role === 'user')
    // const tools = mcpTools ? mcpToolsToAnthropicTools(mcpTools) : undefined

    let systemPrompt = assistant.prompt
    if (mcpTools && mcpTools.length > 0) {
      systemPrompt = buildSystemPrompt(systemPrompt, mcpTools)
    }

    let systemMessage: TextBlockParam | undefined = undefined
    if (systemPrompt) {
      systemMessage = {
        type: 'text',
        text: systemPrompt
      }
    }

    const body: MessageCreateParamsNonStreaming = {
      model: model.id,
      messages: userMessages,
      // tools: isEmpty(tools) ? undefined : tools,
      max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
      temperature: this.getTemperature(assistant, model),
      top_p: this.getTopP(assistant, model),
      system: systemMessage ? [systemMessage] : undefined,
      // @ts-ignore thinking
      thinking: this.getBudgetToken(assistant, model),
      ...this.getCustomParameters(assistant)
    }

    let time_first_token_millsec = 0
    let time_first_content_millsec = 0
    let checkThinkingContent = false
    let thinking_content = ''
    const start_time_millsec = new Date().getTime()

    if (!streamOutput) {
      const message = await this.sdk.messages.create({ ...body, stream: false })
      const time_completion_millsec = new Date().getTime() - start_time_millsec

      let text = ''
      let reasoning_content = ''

      if (message.content && message.content.length > 0) {
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
        type: ChunkType.BLOCK_COMPLETE,
        response: {
          text,
          reasoning_content,
          usage: message.usage as any,
          metrics: {
            completion_tokens: message.usage.output_tokens,
            time_completion_millsec,
            time_first_token_millsec: 0
          }
        }
      })
    }

    const { abortController, cleanup } = this.createAbortController(lastUserMessage?.id)
    const { signal } = abortController
    const toolResponses: MCPToolResponse[] = []

    const processStream = (body: MessageCreateParamsNonStreaming, idx: number) => {
      return new Promise<void>((resolve, reject) => {
        // 等待接口返回流
        onChunk({ type: ChunkType.LLM_RESPONSE_CREATED })
        let hasThinkingContent = false
        this.sdk.messages
          .stream({ ...body, stream: true }, { signal })
          .on('text', (text) => {
            if (hasThinkingContent && !checkThinkingContent) {
              checkThinkingContent = true
              onChunk({
                type: ChunkType.THINKING_COMPLETE,
                text: thinking_content,
                thinking_millsec: time_first_content_millsec - time_first_token_millsec
              })
              // FIXME: 临时方案，重置时间戳和思考内容
              time_first_token_millsec = 0
              time_first_content_millsec = 0
              thinking_content = ''
              checkThinkingContent = false
              hasThinkingContent = false
            }
            if (time_first_token_millsec == 0) {
              time_first_token_millsec = new Date().getTime() - start_time_millsec
            }

            if (hasThinkingContent && time_first_content_millsec === 0) {
              time_first_content_millsec = new Date().getTime()
            }

            onChunk({ type: ChunkType.TEXT_DELTA, text })
          })
          .on('thinking', (thinking) => {
            hasThinkingContent = true
            const currentTime = new Date().getTime() // Get current time for each chunk

            if (time_first_token_millsec == 0) {
              time_first_token_millsec = currentTime - start_time_millsec
            }

            // Set time_first_content_millsec ONLY when the first content (thinking or text) arrives
            if (time_first_content_millsec === 0) {
              time_first_content_millsec = currentTime
            }

            // Calculate thinking time as time elapsed since start until this chunk
            const thinking_time = currentTime - time_first_content_millsec

            onChunk({
              type: ChunkType.THINKING_DELTA,
              text: thinking,
              thinking_millsec: thinking_time
            })
            thinking_content += thinking
          })
          .on('finalMessage', async (message) => {
            const content = message.content[0]
            if (content && content.type === 'text') {
              onChunk({ type: ChunkType.TEXT_COMPLETE, text: content.text })
              const toolResults = await parseAndCallTools(
                content.text,
                toolResponses,
                onChunk,
                idx,
                mcpToolCallResponseToAnthropicMessage,
                mcpTools,
                isVisionModel(model)
              )
              if (toolResults.length > 0) {
                userMessages.push({
                  role: message.role,
                  content: message.content
                })

                toolResults.forEach((ts) => userMessages.push(ts as MessageParam))
                const newBody = body
                newBody.messages = userMessages
                await processStream(newBody, idx + 1)
              }
            }

            const time_completion_millsec = new Date().getTime() - start_time_millsec

            onChunk({
              type: ChunkType.BLOCK_COMPLETE,
              response: {
                usage: {
                  prompt_tokens: message.usage.input_tokens,
                  completion_tokens: message.usage.output_tokens,
                  total_tokens: sum(Object.values(message.usage))
                },
                metrics: {
                  completion_tokens: message.usage.output_tokens,
                  time_completion_millsec,
                  time_first_token_millsec
                }
              }
            })

            resolve()
          })
          .on('error', (error) => reject(error))
          .on('abort', () => {
            reject(new Error('Request was aborted.'))
          })
      })
    }

    await processStream(body, 0).finally(cleanup)
  }

  /**
   * Translate a message
   * @param message - The message
   * @param assistant - The assistant
   * @param onResponse - The onResponse callback
   * @returns The translated message
   */
  public async translate(
    content: string,
    assistant: Assistant,
    onResponse?: (text: string, isComplete: boolean) => void
  ) {
    const defaultModel = getDefaultModel()
    const model = assistant.model || defaultModel

    const messagesForApi = [{ role: 'user' as const, content: content }]

    const stream = !!onResponse

    const body: MessageCreateParamsNonStreaming = {
      model: model.id,
      messages: messagesForApi,
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
          onResponse?.(text, false)
        })
        .on('finalMessage', () => {
          onResponse?.(text, true)
          resolve(text)
        })
        .on('error', (error) => reject(error))
    })
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

    if (first(userMessages)?.role === 'assistant') {
      userMessages.shift()
    }

    const userMessageContent = userMessages.reduce((prev, curr) => {
      const currentContent = curr.role === 'user' ? `User: ${curr.content}` : `Assistant: ${curr.content}`
      return prev + (prev ? '\n' : '') + currentContent
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

    const responseContent = message.content[0].type === 'text' ? message.content[0].text : ''
    return removeSpecialCharactersForTopicName(responseContent)
  }

  /**
   * Summarize a message for search
   * @param messages - The messages
   * @param assistant - The assistant
   * @returns The summary
   */
  public async summaryForSearch(messages: Message[], assistant: Assistant): Promise<string | null> {
    const model = assistant.model || getDefaultModel()
    const systemMessage = { content: assistant.prompt }

    const userMessageContent = messages.map((m) => getMainTextContent(m)).join('\n')

    const userMessage = {
      role: 'user' as const,
      content: userMessageContent
    }
    const lastUserMessage = messages[messages.length - 1]
    const { abortController, cleanup } = this.createAbortController(lastUserMessage?.id)
    const { signal } = abortController

    const response = await this.sdk.messages
      .create(
        {
          messages: [userMessage],
          model: model.id,
          system: systemMessage.content,
          stream: false,
          max_tokens: 4096
        },
        { timeout: 20 * 1000, signal }
      )
      .finally(cleanup)

    const responseContent = response.content[0].type === 'text' ? response.content[0].text : ''
    return responseContent
  }

  /**
   * Generate text
   * @param prompt - The prompt
   * @param content - The content
   * @returns The generated text
   */
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

  /**
   * Generate an image
   * @returns The generated image
   */
  public async generateImage(): Promise<string[]> {
    return []
  }

  public async generateImageByChat(): Promise<void> {
    throw new Error('Method not implemented.')
  }

  /**
   * Generate suggestions
   * @returns The suggestions
   */
  public async suggestions(): Promise<Suggestion[]> {
    return []
  }

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

    const body = {
      model: model.id,
      messages: [{ role: 'user' as const, content: 'hi' }],
      max_tokens: 100,
      stream
    }

    try {
      if (!stream) {
        const message = await this.sdk.messages.create(body as MessageCreateParamsNonStreaming)
        return {
          valid: message.content.length > 0,
          error: null
        }
      } else {
        return await new Promise((resolve, reject) => {
          let hasContent = false
          this.sdk.messages
            .stream(body)
            .on('text', (text) => {
              if (!hasContent && text) {
                hasContent = true
                resolve({ valid: true, error: null })
              }
            })
            .on('finalMessage', (message) => {
              if (!hasContent && message.content && message.content.length > 0) {
                hasContent = true
                resolve({ valid: true, error: null })
              }
              if (!hasContent) {
                reject(new Error('Empty streaming response'))
              }
            })
            .on('error', (error) => reject(error))
        })
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
    return []
  }

  public async getEmbeddingDimensions(): Promise<number> {
    return 0
  }
}
