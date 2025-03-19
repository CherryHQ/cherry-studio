import Anthropic from '@anthropic-ai/sdk'
import {
  MessageCreateParamsNonStreaming,
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock
} from '@anthropic-ai/sdk/resources'
import { DEFAULT_MAX_TOKENS } from '@renderer/config/constant'
import { isReasoningModel } from '@renderer/config/models'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import { getAssistantSettings, getDefaultModel, getTopNamingModel } from '@renderer/services/AssistantService'
import {
  filterContextMessages,
  filterEmptyMessages,
  filterUserRoleStartMessages
} from '@renderer/services/MessagesService'
import { Assistant, FileTypes, MCPToolResponse, Message, Model, Provider, Suggestion } from '@renderer/types'
import { removeSpecialCharactersForTopicName } from '@renderer/utils'
import {
  anthropicToolUseToMcpTool,
  callMCPTool,
  filterMCPTools,
  mcpToolsToAnthropicTools,
  upsertMCPToolResponse
} from '@renderer/utils/mcp-tools'
import { first, flatten, isEmpty, sum, takeRight } from 'lodash'
import OpenAI from 'openai'

import { CompletionsParams } from '.'
import BaseProvider from './BaseProvider'

type ReasoningEffort = 'high' | 'medium' | 'low'

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
      dangerouslyAllowBrowser: true
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
  private getReasoningEffort(assistant: Assistant, model: Model): ReasoningConfig | undefined {
    if (!isReasoningModel(model)) {
      return undefined
    }

    const effortRatios: Record<ReasoningEffort, number> = {
      high: 0.8,
      medium: 0.5,
      low: 0.2
    }

    const effort = assistant?.settings?.reasoning_effort as ReasoningEffort
    const effortRatio = effortRatios[effort]

    if (!effortRatio) {
      return undefined
    }

    const isClaude37Sonnet = model.id.includes('claude-3-7-sonnet') || model.id.includes('claude-3.7-sonnet')

    if (!isClaude37Sonnet) {
      return undefined
    }

    const maxTokens = assistant?.settings?.maxTokens || DEFAULT_MAX_TOKENS
    const budgetTokens = Math.trunc(Math.max(Math.min(maxTokens * effortRatio, 32000), 1024))

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
    mcpTools = filterMCPTools(mcpTools, lastUserMessage?.enabledMCPs)
    const tools = mcpTools ? mcpToolsToAnthropicTools(mcpTools) : undefined

    const body: MessageCreateParamsNonStreaming = {
      model: model.id,
      messages: userMessages,
      tools: isEmpty(tools) ? undefined : tools,
      max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
      temperature: this.getTemperature(assistant, model),
      top_p: this.getTopP(assistant, model),
      system: assistant.prompt,
      // @ts-ignore thinking
      thinking: this.getReasoningEffort(assistant, model),
      ...this.getCustomParameters(assistant)
    }

    let time_first_token_millsec = 0
    let time_first_content_millsec = 0
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

    const { abortController, cleanup } = this.createAbortController(lastUserMessage?.id)
    const { signal } = abortController
    const toolResponses: MCPToolResponse[] = []

    const processStream = (body: MessageCreateParamsNonStreaming, idx: number) => {
      return new Promise<void>((resolve, reject) => {
        const toolCalls: ToolUseBlock[] = []
        let hasThinkingContent = false
        this.sdk.messages
          .stream({ ...body, stream: true }, { signal })
          .on('text', (text) => {
            // if (window.keyv.get(EVENT_NAMES.CHAT_COMPLETION_PAUSED)) {
            //   stream.controller.abort()
            //   return resolve()
            // }

            if (time_first_token_millsec == 0) {
              time_first_token_millsec = new Date().getTime() - start_time_millsec
            }

            if (hasThinkingContent && time_first_content_millsec === 0) {
              time_first_content_millsec = new Date().getTime()
            }

            const time_thinking_millsec = time_first_content_millsec
              ? time_first_content_millsec - start_time_millsec
              : 0

            const time_completion_millsec = new Date().getTime() - start_time_millsec

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
          .on('contentBlock', (content) => {
            if (content.type == 'tool_use') {
              toolCalls.push(content)
            }
          })
          .on('finalMessage', async (message) => {
            if (toolCalls.length > 0) {
              const toolCallResults: ToolResultBlockParam[] = []

              for (const toolCall of toolCalls) {
                const mcpTool = anthropicToolUseToMcpTool(mcpTools, toolCall)
                if (mcpTool) {
                  upsertMCPToolResponse(toolResponses, { tool: mcpTool, status: 'invoking', id: toolCall.id }, onChunk)
                  const resp = await callMCPTool(mcpTool)
                  toolCallResults.push({ type: 'tool_result', tool_use_id: toolCall.id, content: resp.content })
                  upsertMCPToolResponse(
                    toolResponses,
                    { tool: mcpTool, status: 'done', response: resp, id: toolCall.id },
                    onChunk
                  )
                }
              }

              if (toolCallResults.length > 0) {
                userMessages.push({
                  role: message.role,
                  content: message.content
                })

                userMessages.push({
                  role: 'user',
                  content: toolCallResults
                })

                const newBody = body
                body.messages = userMessages

                await processStream(newBody, idx + 1)
              }
            }

            const time_completion_millsec = new Date().getTime() - start_time_millsec
            const time_thinking_millsec = time_first_content_millsec
              ? time_first_content_millsec - start_time_millsec
              : 0

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
              },
              mcpToolResponse: toolResponses
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

    return removeSpecialCharactersForTopicName(content)
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
   * @returns The validity of the model
   */
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
