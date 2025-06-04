import Anthropic from '@anthropic-ai/sdk'
import {
  Base64ImageSource,
  ImageBlockParam,
  MessageCreateParamsNonStreaming,
  MessageParam,
  TextBlockParam,
  ToolResultBlockParam,
  WebSearchTool20250305
} from '@anthropic-ai/sdk/resources'
import Logger from '@renderer/config/logger'
import { isWebSearchModel } from '@renderer/config/models'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import { getDefaultModel, getTopNamingModel } from '@renderer/services/AssistantService'
import FileManager from '@renderer/services/FileManager'
import {
  Assistant,
  FileTypes,
  MCPCallToolResponse,
  MCPTool,
  MCPToolResponse,
  Model,
  Provider,
  Suggestion
} from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { removeSpecialCharactersForTopicName } from '@renderer/utils'
import { mcpToolCallResponseToAnthropicMessage, mcpToolsToAnthropicTools } from '@renderer/utils/mcp-tools'
import { findFileBlocks, findImageBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { first, takeRight } from 'lodash'
import OpenAI from 'openai'

import { CompletionsParams, CompletionsResult } from '../middleware/schemas'
import BaseProvider from './BaseProvider'

export default class AnthropicProvider extends BaseProvider {
  private sdk: Anthropic
  constructor(provider: Provider) {
    super(provider)
    this.sdk = this.apiClient.getSdkInstance()
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
    }
    // Get and process file blocks
    const fileBlocks = findFileBlocks(message)
    for (const fileBlock of fileBlocks) {
      const { file } = fileBlock
      if ([FileTypes.TEXT, FileTypes.DOCUMENT].includes(file.type)) {
        if (file.ext === '.pdf' && file.size < 32 * 1024 * 1024) {
          const base64Data = await FileManager.readBase64File(file)
          parts.push({
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64Data
            }
          })
        } else {
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

  private async getWebSearchParams(model: Model): Promise<WebSearchTool20250305 | undefined> {
    if (!isWebSearchModel(model)) {
      return undefined
    }

    return {
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 5
    } as WebSearchTool20250305
  }

  /**
   * Generate completions
   * @param messages - The messages
   * @param assistant - The assistant
   * @param mcpTools - The MCP tools
   * @param onChunk - The onChunk callback
   * @param onFilterMessages - The onFilterMessages callback
   */
  async completions(params: CompletionsParams): Promise<CompletionsResult> {
    Logger.debug('[AnthropicProvider] completions called with params:', {
      messagesCount: params.messages?.length || 0,
      streamOutput: params.streamOutput,
      assistantId: params.assistant?.id,
      modelId: params.assistant?.model?.id
    })

    try {
      Logger.debug('[AnthropicProvider] calling apiClient.completions...')
      const result = await this.apiClient.completions(params)
      Logger.debug('[AnthropicProvider] apiClient.completions completed successfully')
      return result
    } catch (error) {
      Logger.error('[AnthropicProvider] apiClient.completions failed:', error)
      throw error
    }
  }

  /**
   * Translate a message
   * @param content
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

    const sdk = await this.apiClient.getSdkInstance()

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
      const response = await sdk.messages.create({ ...body, stream: false })
      return response.content[0].type === 'text' ? response.content[0].text : ''
    }

    let text = ''

    return new Promise<string>((resolve, reject) => {
      sdk.messages
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

    const response = await this.sdk.messages.create(
      {
        messages: [userMessage],
        model: model.id,
        system: systemMessage.content,
        stream: false,
        max_tokens: 4096
      },
      { timeout: 20 * 1000 }
    )

    return response.content[0].type === 'text' ? response.content[0].text : ''
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
      max_tokens: 2, // api文档写的 x>1
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

  public convertMcpTools<T>(mcpTools: MCPTool[]): T[] {
    return mcpToolsToAnthropicTools(mcpTools) as T[]
  }

  public mcpToolCallResponseToMessage = (mcpToolResponse: MCPToolResponse, resp: MCPCallToolResponse, model: Model) => {
    if ('toolUseId' in mcpToolResponse && mcpToolResponse.toolUseId) {
      return mcpToolCallResponseToAnthropicMessage(mcpToolResponse, resp, model)
    } else if ('toolCallId' in mcpToolResponse) {
      return {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: mcpToolResponse.toolCallId!,
            content: resp.content
              .map((item) => {
                if (item.type === 'text') {
                  return {
                    type: 'text',
                    text: item.text || ''
                  } satisfies TextBlockParam
                }
                if (item.type === 'image') {
                  return {
                    type: 'image',
                    source: {
                      data: item.data || '',
                      media_type: (item.mimeType || 'image/png') as Base64ImageSource['media_type'],
                      type: 'base64'
                    }
                  } satisfies ImageBlockParam
                }
                return
              })
              .filter((n) => typeof n !== 'undefined'),
            is_error: resp.isError
          } satisfies ToolResultBlockParam
        ]
      }
    }
    return
  }
}
