import {
  getOpenAIWebSearchParams,
  isOpenAILLMModel,
  isOpenAIReasoningModel,
  isOpenAIWebSearch,
  isSupportedModel,
  isSupportedReasoningEffortOpenAIModel,
  isVisionModel
} from '@renderer/config/models'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import { getAssistantSettings, getDefaultModel, getTopNamingModel } from '@renderer/services/AssistantService'
import { EVENT_NAMES } from '@renderer/services/EventService'
import FileManager from '@renderer/services/FileManager'
import {
  filterContextMessages,
  filterEmptyMessages,
  filterUserRoleStartMessages
} from '@renderer/services/MessagesService'
import {
  Assistant,
  FileTypes,
  GenerateImageParams,
  MCPCallToolResponse,
  MCPTool,
  MCPToolResponse,
  Model,
  Provider,
  Suggestion,
  ToolCallResponse,
  Usage,
  WebSearchSource
} from '@renderer/types'
import { ChunkType } from '@renderer/types/chunk'
import { Message } from '@renderer/types/newMessage'
import { removeSpecialCharactersForTopicName } from '@renderer/utils'
import { addImageFileToContents } from '@renderer/utils/formats'
import { convertLinks } from '@renderer/utils/linkConverter'
import {
  mcpToolCallResponseToOpenAIMessage,
  mcpToolsToOpenAIResponseTools,
  openAIToolsToMcpTool,
  parseAndCallTools
} from '@renderer/utils/mcp-tools'
import { findFileBlocks, findImageBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { buildSystemPrompt } from '@renderer/utils/prompt'
import { isEmpty, takeRight } from 'lodash'
import OpenAI from 'openai'
import { ChatCompletionContentPart, ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { Stream } from 'openai/streaming'
import { FileLike, toFile } from 'openai/uploads'

import { CompletionsParams } from '.'
import BaseProvider from './BaseProvider'

export abstract class BaseOpenAiProvider extends BaseProvider {
  protected sdk: OpenAI

  constructor(provider: Provider) {
    super(provider)

    this.sdk = new OpenAI({
      dangerouslyAllowBrowser: true,
      apiKey: this.apiKey,
      baseURL: this.getBaseURL(),
      defaultHeaders: {
        ...this.defaultHeaders()
      }
    })
  }

  abstract convertMcpTools<T>(mcpTools: MCPTool[]): T[]

  abstract mcpToolCallResponseToMessage: (
    mcpToolResponse: MCPToolResponse,
    resp: MCPCallToolResponse,
    model: Model
  ) => OpenAI.Responses.ResponseInputItem | ChatCompletionMessageParam | undefined

  /**
   * Extract the file content from the message
   * @param message - The message
   * @returns The file content
   */
  protected async extractFileContent(message: Message) {
    const fileBlocks = findFileBlocks(message)
    if (fileBlocks.length > 0) {
      const textFileBlocks = fileBlocks.filter(
        (fb) => fb.file && [FileTypes.TEXT, FileTypes.DOCUMENT].includes(fb.file.type)
      )

      if (textFileBlocks.length > 0) {
        let text = ''
        const divider = '\n\n---\n\n'

        for (const fileBlock of textFileBlocks) {
          const file = fileBlock.file
          const fileContent = (await window.api.file.read(file.id + file.ext)).trim()
          const fileNameRow = 'file: ' + file.origin_name + '\n\n'
          text = text + fileNameRow + fileContent + divider
        }

        return text
      }
    }

    return ''
  }

  private async getReponseMessageParam(message: Message, model: Model): Promise<OpenAI.Responses.ResponseInputItem> {
    const isVision = isVisionModel(model)
    const content = await this.getMessageContent(message)
    const fileBlocks = findFileBlocks(message)
    const imageBlocks = findImageBlocks(message)

    if (fileBlocks.length === 0 && imageBlocks.length === 0) {
      if (message.role === 'assistant') {
        return {
          role: 'assistant',
          content: content
        }
      } else {
        return {
          role: message.role === 'system' ? 'user' : message.role,
          content: content ? [{ type: 'input_text', text: content }] : []
        } as OpenAI.Responses.EasyInputMessage
      }
    }

    const parts: OpenAI.Responses.ResponseInputContent[] = []
    if (content) {
      parts.push({
        type: 'input_text',
        text: content
      })
    }

    for (const imageBlock of imageBlocks) {
      if (isVision) {
        if (imageBlock.file) {
          const image = await window.api.file.base64Image(imageBlock.file.id + imageBlock.file.ext)
          parts.push({
            detail: 'auto',
            type: 'input_image',
            image_url: image.data as string
          })
        } else if (imageBlock.url && imageBlock.url.startsWith('data:')) {
          parts.push({
            detail: 'auto',
            type: 'input_image',
            image_url: imageBlock.url
          })
        }
      }
    }

    for (const fileBlock of fileBlocks) {
      const file = fileBlock.file
      if (!file) continue

      if ([FileTypes.TEXT, FileTypes.DOCUMENT].includes(file.type)) {
        const fileContent = (await window.api.file.read(file.id + file.ext)).trim()
        parts.push({
          type: 'input_text',
          text: file.origin_name + '\n' + fileContent
        })
      }
    }

    return {
      role: message.role === 'system' ? 'user' : message.role,
      content: parts
    }
  }

  protected getServiceTier(model: Model) {
    if ((model.id.includes('o3') && !model.id.includes('o3-mini')) || model.id.includes('o4-mini')) {
      return 'flex'
    }
    if (isOpenAILLMModel(model)) {
      return 'auto'
    }
    return undefined
  }

  protected getTimeout(model: Model) {
    if ((model.id.includes('o3') && !model.id.includes('o3-mini')) || model.id.includes('o4-mini')) {
      return 15 * 1000 * 60
    }
    return 5 * 1000 * 60
  }

  /**
   * Get the temperature for the assistant
   * @param assistant - The assistant
   * @param model - The model
   * @returns The temperature
   */
  protected getTemperature(assistant: Assistant, model: Model) {
    return isOpenAIReasoningModel(model) || isOpenAILLMModel(model) ? undefined : assistant?.settings?.temperature
  }

  /**
   * Get the top P for the assistant
   * @param assistant - The assistant
   * @param model - The model
   * @returns The top P
   */
  protected getTopP(assistant: Assistant, model: Model) {
    return isOpenAIReasoningModel(model) || isOpenAILLMModel(model) ? undefined : assistant?.settings?.topP
  }

  private getResponseReasoningEffort(assistant: Assistant, model: Model) {
    if (!isSupportedReasoningEffortOpenAIModel(model)) {
      return {}
    }

    const reasoningEffort = assistant?.settings?.reasoning_effort
    if (!reasoningEffort) {
      return {}
    }

    if (isSupportedReasoningEffortOpenAIModel(model)) {
      return {
        reasoning: {
          effort: reasoningEffort as OpenAI.ReasoningEffort,
          summary: 'detailed'
        } as OpenAI.Reasoning
      }
    }

    return {}
  }

  /**
   * Get the message parameter
   * @param message - The message
   * @param model - The model
   * @returns The message parameter
   */
  protected async getMessageParam(
    message: Message,
    model: Model
  ): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam> {
    const isVision = isVisionModel(model)
    const content = await this.getMessageContent(message)
    const fileBlocks = findFileBlocks(message)
    const imageBlocks = findImageBlocks(message)

    if (fileBlocks.length === 0 && imageBlocks.length === 0) {
      return {
        role: message.role === 'system' ? 'user' : message.role,
        content
      }
    }

    const parts: ChatCompletionContentPart[] = []

    if (content) {
      parts.push({ type: 'text', text: content })
    }

    for (const imageBlock of imageBlocks) {
      if (isVision) {
        if (imageBlock.file) {
          const image = await window.api.file.base64Image(imageBlock.file.id + imageBlock.file.ext)
          parts.push({ type: 'image_url', image_url: { url: image.data } })
        } else if (imageBlock.url && imageBlock.url.startsWith('data:')) {
          parts.push({ type: 'image_url', image_url: { url: imageBlock.url } })
        }
      }
    }

    for (const fileBlock of fileBlocks) {
      const { file } = fileBlock
      if (!file) {
        continue
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
      role: message.role === 'system' ? 'user' : message.role,
      content: parts
    } as ChatCompletionMessageParam
  }

  /**
   * Generate completions for the assistant use Response API
   * @param messages - The messages
   * @param assistant - The assistant
   * @param mcpTools
   * @param onChunk - The onChunk callback
   * @param onFilterMessages - The onFilterMessages callback
   * @returns The completions
   */
  async completions({ messages, assistant, mcpTools, onChunk, onFilterMessages }: CompletionsParams): Promise<void> {
    if (assistant.enableGenerateImage) {
      await this.generateImageByChat({ messages, assistant, onChunk } as CompletionsParams)
      return
    }
    const defaultModel = getDefaultModel()
    const model = assistant.model || defaultModel
    const { contextCount, maxTokens, streamOutput, enableToolUse } = getAssistantSettings(assistant)
    const isEnabledWebSearch = assistant.enableWebSearch || !!assistant.webSearchProviderId
    // 退回到 OpenAI 兼容模式
    if (isOpenAIWebSearch(model)) {
      const systemMessage = { role: 'system', content: assistant.prompt || '' }
      const userMessages: ChatCompletionMessageParam[] = []
      const _messages = filterUserRoleStartMessages(
        filterEmptyMessages(filterContextMessages(takeRight(messages, contextCount + 1)))
      )
      onFilterMessages(_messages)

      for (const message of _messages) {
        userMessages.push(await this.getMessageParam(message, model))
      }
      //当 systemMessage 内容为空时不发送 systemMessage
      let reqMessages: ChatCompletionMessageParam[]
      if (!systemMessage.content) {
        reqMessages = [...userMessages]
      } else {
        reqMessages = [systemMessage, ...userMessages].filter(Boolean) as ChatCompletionMessageParam[]
      }
      const lastUserMessage = _messages.findLast((m) => m.role === 'user')
      const { abortController, cleanup, signalPromise } = this.createAbortController(lastUserMessage?.id, true)
      const { signal } = abortController
      let time_first_token_millsec_delta = 0
      const start_time_millsec = new Date().getTime()
      const response = await this.sdk.chat.completions
        // @ts-ignore key is not typed
        .create(
          {
            model: model.id,
            messages: reqMessages,
            stream: true,
            temperature: this.getTemperature(assistant, model),
            top_p: this.getTopP(assistant, model),
            max_tokens: maxTokens,
            ...getOpenAIWebSearchParams(assistant, model),
            ...this.getCustomParameters(assistant)
          },
          {
            signal
          }
        )
      const processStream = async (stream: any) => {
        let content = ''
        let isFirstChunk = true
        let final_time_completion_millsec_delta = 0
        let lastUsage: Usage | undefined = undefined
        for await (const chunk of stream as any) {
          if (window.keyv.get(EVENT_NAMES.CHAT_COMPLETION_PAUSED)) {
            break
          }
          const delta = chunk.choices[0]?.delta
          const finishReason = chunk.choices[0]?.finish_reason
          if (delta?.content) {
            if (delta?.annotations) {
              delta.content = convertLinks(delta.content || '', isFirstChunk)
            }
            if (isFirstChunk) {
              isFirstChunk = false
              time_first_token_millsec_delta = new Date().getTime() - start_time_millsec
            }
            content += delta.content
            onChunk({ type: ChunkType.TEXT_DELTA, text: delta.content })
          }
          if (!isEmpty(finishReason) || chunk?.annotations) {
            onChunk({ type: ChunkType.TEXT_COMPLETE, text: content })
            final_time_completion_millsec_delta = new Date().getTime() - start_time_millsec
            if (chunk.usage) {
              lastUsage = chunk.usage
            }
          }
          if (delta?.annotations) {
            onChunk({
              type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
              llm_web_search: {
                results: delta.annotations,
                source: WebSearchSource.OPENAI_COMPATIBLE
              }
            })
          }
        }
        onChunk({
          type: ChunkType.BLOCK_COMPLETE,
          response: {
            usage: lastUsage,
            metrics: {
              completion_tokens: lastUsage?.completion_tokens,
              time_completion_millsec: final_time_completion_millsec_delta,
              time_first_token_millsec: time_first_token_millsec_delta
            }
          }
        })
      }
      await processStream(response).finally(cleanup)
      await signalPromise?.promise?.catch((error) => {
        throw error
      })
      return
    }
    let tools: OpenAI.Responses.Tool[] = []
    if (isEnabledWebSearch) {
      tools.push({
        type: 'web_search_preview'
      })
    }
    messages = addImageFileToContents(messages)
    const systemMessage: OpenAI.Responses.EasyInputMessage = {
      role: 'system',
      content: []
    }
    const systemMessageContent: OpenAI.Responses.ResponseInputMessageContentList = []
    const systemMessageInput: OpenAI.Responses.ResponseInputText = {
      text: assistant.prompt || '',
      type: 'input_text'
    }
    if (isSupportedReasoningEffortOpenAIModel(model)) {
      systemMessageInput.text = `Formatting re-enabled${systemMessageInput.text ? '\n' + systemMessageInput.text : ''}`
      systemMessage.role = 'developer'
    }

    const { tools: extraTools } = this.setupToolsConfig<OpenAI.Responses.Tool>({
      mcpTools,
      model,
      enableToolUse
    })

    tools = tools.concat(extraTools)

    if (this.useSystemPromptForTools) {
      systemMessageInput.text = buildSystemPrompt(systemMessageInput.text || '', mcpTools)
    }
    systemMessageContent.push(systemMessageInput)
    systemMessage.content = systemMessageContent
    const _messages = filterUserRoleStartMessages(
      filterEmptyMessages(filterContextMessages(takeRight(messages, contextCount + 1)))
    )

    onFilterMessages(_messages)
    const userMessage: OpenAI.Responses.ResponseInputItem[] = []
    for (const message of _messages) {
      userMessage.push(await this.getReponseMessageParam(message, model))
    }

    let time_first_token_millsec = 0
    const start_time_millsec = new Date().getTime()

    const lastUserMessage = _messages.findLast((m) => m.role === 'user')
    const { abortController, cleanup, signalPromise } = this.createAbortController(lastUserMessage?.id, true)
    const { signal } = abortController

    // 当 systemMessage 内容为空时不发送 systemMessage
    let reqMessages: OpenAI.Responses.ResponseInput
    if (!systemMessage.content) {
      reqMessages = [...userMessage]
    } else {
      reqMessages = [systemMessage, ...userMessage].filter(Boolean) as OpenAI.Responses.EasyInputMessage[]
    }

    const toolResponses: MCPToolResponse[] = []

    const processToolResults = async (toolResults: Awaited<ReturnType<typeof parseAndCallTools>>, idx: number) => {
      if (toolResults.length === 0) return

      toolResults.forEach((ts) => reqMessages.push(ts as OpenAI.Responses.EasyInputMessage))

      onChunk({ type: ChunkType.LLM_RESPONSE_CREATED })
      const stream = await this.sdk.responses.create(
        {
          model: model.id,
          input: reqMessages,
          temperature: this.getTemperature(assistant, model),
          top_p: this.getTopP(assistant, model),
          max_output_tokens: maxTokens,
          stream: streamOutput,
          tools: !isEmpty(tools) ? tools : undefined,
          service_tier: this.getServiceTier(model),
          ...this.getResponseReasoningEffort(assistant, model),
          ...this.getCustomParameters(assistant)
        },
        {
          signal,
          timeout: this.getTimeout(model)
        }
      )
      await processStream(stream, idx + 1)
    }

    const processToolCalls = async (mcpTools, toolCalls: OpenAI.Responses.ResponseFunctionToolCall[]) => {
      const mcpToolResponses = toolCalls
        .map((toolCall) => {
          const mcpTool = openAIToolsToMcpTool(mcpTools, toolCall as OpenAI.Responses.ResponseFunctionToolCall)
          if (!mcpTool) return undefined

          const parsedArgs = (() => {
            try {
              return JSON.parse(toolCall.arguments)
            } catch {
              return toolCall.arguments
            }
          })()

          return {
            id: toolCall.call_id,
            toolCallId: toolCall.call_id,
            tool: mcpTool,
            arguments: parsedArgs,
            status: 'pending'
          } as ToolCallResponse
        })
        .filter((t): t is ToolCallResponse => typeof t !== 'undefined')

      return await parseAndCallTools<OpenAI.Responses.ResponseInputItem | ChatCompletionMessageParam>(
        mcpToolResponses,
        toolResponses,
        onChunk,
        this.mcpToolCallResponseToMessage,
        model,
        mcpTools
      )
    }

    const processToolUses = async (content: string) => {
      return await parseAndCallTools(
        content,
        toolResponses,
        onChunk,
        this.mcpToolCallResponseToMessage,
        model,
        mcpTools
      )
    }

    const processStream = async (
      stream: Stream<OpenAI.Responses.ResponseStreamEvent> | OpenAI.Responses.Response,
      idx: number
    ) => {
      const toolCalls: OpenAI.Responses.ResponseFunctionToolCall[] = []

      if (!streamOutput) {
        const nonStream = stream as OpenAI.Responses.Response
        const time_completion_millsec = new Date().getTime() - start_time_millsec
        const completion_tokens =
          (nonStream.usage?.output_tokens || 0) + (nonStream.usage?.output_tokens_details.reasoning_tokens ?? 0)
        const total_tokens =
          (nonStream.usage?.total_tokens || 0) + (nonStream.usage?.output_tokens_details.reasoning_tokens ?? 0)
        const finalMetrics = {
          completion_tokens,
          time_completion_millsec,
          time_first_token_millsec: 0
        }
        const finalUsage = {
          completion_tokens,
          prompt_tokens: nonStream.usage?.input_tokens || 0,
          total_tokens
        }
        let content = ''

        for (const output of nonStream.output) {
          switch (output.type) {
            case 'message':
              if (output.content[0].type === 'output_text') {
                onChunk({ type: ChunkType.TEXT_DELTA, text: output.content[0].text })
                onChunk({ type: ChunkType.TEXT_COMPLETE, text: output.content[0].text })
                content += output.content[0].text
                if (output.content[0].annotations && output.content[0].annotations.length > 0) {
                  onChunk({
                    type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
                    llm_web_search: {
                      source: WebSearchSource.OPENAI,
                      results: output.content[0].annotations
                    }
                  })
                }
              }
              break
            case 'reasoning':
              onChunk({
                type: ChunkType.THINKING_COMPLETE,
                text: output.summary.map((s) => s.text).join('\n'),
                thinking_millsec: new Date().getTime() - start_time_millsec
              })
              break
            case 'function_call':
              toolCalls.push(output)
          }
        }

        if (content) {
          reqMessages.push({
            role: 'assistant',
            content: content
          })
        }
        if (toolCalls.length) {
          toolCalls.forEach((toolCall) => {
            reqMessages.push(toolCall)
          })
        }

        const toolResults: Awaited<ReturnType<typeof parseAndCallTools>> = []
        if (toolCalls.length) {
          toolResults.push(...(await processToolCalls(mcpTools, toolCalls)))
        }
        if (content.length) {
          toolResults.push(...(await processToolUses(content)))
        }
        await processToolResults(toolResults, idx)

        onChunk({
          type: ChunkType.BLOCK_COMPLETE,
          response: {
            usage: finalUsage,
            metrics: finalMetrics
          }
        })
        return
      }
      let content = ''

      const outputItems: OpenAI.Responses.ResponseOutputItem[] = []

      let lastUsage: Usage | undefined = undefined
      let final_time_completion_millsec_delta = 0
      for await (const chunk of stream as Stream<OpenAI.Responses.ResponseStreamEvent>) {
        if (window.keyv.get(EVENT_NAMES.CHAT_COMPLETION_PAUSED)) {
          break
        }
        switch (chunk.type) {
          case 'response.created':
            time_first_token_millsec = new Date().getTime()
            break
          case 'response.output_item.added':
            if (chunk.item.type === 'function_call') {
              outputItems.push(chunk.item)
            }
            break

          case 'response.reasoning_summary_text.delta':
            onChunk({
              type: ChunkType.THINKING_DELTA,
              text: chunk.delta,
              thinking_millsec: new Date().getTime() - time_first_token_millsec
            })
            break
          case 'response.reasoning_summary_text.done':
            onChunk({
              type: ChunkType.THINKING_COMPLETE,
              text: chunk.text,
              thinking_millsec: new Date().getTime() - time_first_token_millsec
            })
            break
          case 'response.output_text.delta':
            onChunk({
              type: ChunkType.TEXT_DELTA,
              text: chunk.delta
            })
            content += chunk.delta
            break
          case 'response.output_text.done':
            onChunk({
              type: ChunkType.TEXT_COMPLETE,
              text: chunk.text
            })
            break
          case 'response.function_call_arguments.done': {
            const outputItem: OpenAI.Responses.ResponseOutputItem | undefined = outputItems.find(
              (item) => item.id === chunk.item_id
            )
            if (outputItem) {
              if (outputItem.type === 'function_call') {
                toolCalls.push({
                  ...outputItem,
                  arguments: chunk.arguments
                })
              }
            }

            break
          }
          case 'response.content_part.done':
            if (chunk.part.type === 'output_text' && chunk.part.annotations && chunk.part.annotations.length > 0) {
              onChunk({
                type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
                llm_web_search: {
                  source: WebSearchSource.OPENAI,
                  results: chunk.part.annotations
                }
              })
            }
            break
          case 'response.completed': {
            final_time_completion_millsec_delta = new Date().getTime() - start_time_millsec
            const completion_tokens =
              (chunk.response.usage?.output_tokens || 0) +
              (chunk.response.usage?.output_tokens_details.reasoning_tokens ?? 0)
            const total_tokens =
              (chunk.response.usage?.total_tokens || 0) +
              (chunk.response.usage?.output_tokens_details.reasoning_tokens ?? 0)
            lastUsage = {
              completion_tokens,
              prompt_tokens: chunk.response.usage?.input_tokens || 0,
              total_tokens
            }
            break
          }
          case 'error':
            onChunk({
              type: ChunkType.ERROR,
              error: {
                message: chunk.message,
                code: chunk.code
              }
            })
            break
        }

        // --- End of Incremental onChunk calls ---
      } // End of for await loop
      if (content) {
        reqMessages.push({
          role: 'assistant',
          content: content
        })
      }
      if (toolCalls.length) {
        toolCalls.forEach((toolCall) => {
          reqMessages.push(toolCall)
        })
      }

      // Call processToolUses AFTER the loop finishes processing the main stream content
      // Note: parseAndCallTools inside processToolUses should handle its own onChunk for tool responses
      const toolResults: Awaited<ReturnType<typeof parseAndCallTools>> = []
      if (toolCalls.length) {
        toolResults.push(...(await processToolCalls(mcpTools, toolCalls)))
      }
      if (content) {
        toolResults.push(...(await processToolUses(content)))
      }
      await processToolResults(toolResults, idx)

      onChunk({
        type: ChunkType.BLOCK_COMPLETE,
        response: {
          usage: lastUsage,
          metrics: {
            completion_tokens: lastUsage?.completion_tokens,
            time_completion_millsec: final_time_completion_millsec_delta,
            time_first_token_millsec: time_first_token_millsec - start_time_millsec
          }
        }
      })
    }

    onChunk({ type: ChunkType.LLM_RESPONSE_CREATED })
    const stream = await this.sdk.responses.create(
      {
        model: model.id,
        input: reqMessages,
        temperature: this.getTemperature(assistant, model),
        top_p: this.getTopP(assistant, model),
        max_output_tokens: maxTokens,
        stream: streamOutput,
        tools: tools.length > 0 ? tools : undefined,
        service_tier: this.getServiceTier(model),
        ...this.getResponseReasoningEffort(assistant, model),
        ...this.getCustomParameters(assistant)
      },
      {
        signal,
        timeout: this.getTimeout(model)
      }
    )

    await processStream(stream, 0).finally(cleanup)

    // 捕获signal的错误
    await signalPromise?.promise?.catch((error) => {
      throw error
    })
  }

  /**
   * Translate the content
   * @param content - The content
   * @param assistant - The assistant
   * @param onResponse - The onResponse callback
   * @returns The translated content
   */
  async translate(
    content: string,
    assistant: Assistant,
    onResponse?: (text: string, isComplete: boolean) => void
  ): Promise<string> {
    const defaultModel = getDefaultModel()
    const model = assistant.model || defaultModel
    const messageForApi: OpenAI.Responses.EasyInputMessage[] = content
      ? [
          {
            role: 'system',
            content: assistant.prompt
          },
          {
            role: 'user',
            content
          }
        ]
      : [{ role: 'user', content: assistant.prompt }]

    const isOpenAIReasoning = isOpenAIReasoningModel(model)
    const isSupportedStreamOutput = () => {
      if (!onResponse) {
        return false
      }
      return !isOpenAIReasoning
    }

    const stream = isSupportedStreamOutput()
    let text = ''
    if (stream) {
      const response = await this.sdk.responses.create({
        model: model.id,
        input: messageForApi,
        stream: true,
        temperature: this.getTemperature(assistant, model),
        top_p: this.getTopP(assistant, model),
        ...this.getResponseReasoningEffort(assistant, model)
      })

      for await (const chunk of response) {
        switch (chunk.type) {
          case 'response.output_text.delta':
            text += chunk.delta
            onResponse?.(text, false)
            break
          case 'response.output_text.done':
            onResponse?.(chunk.text, true)
            break
        }
      }
    } else {
      const response = await this.sdk.responses.create({
        model: model.id,
        input: messageForApi,
        stream: false,
        temperature: this.getTemperature(assistant, model),
        top_p: this.getTopP(assistant, model),
        ...this.getResponseReasoningEffort(assistant, model)
      })
      return response.output_text
    }

    return text
  }

  /**
   * Summarize the messages
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

    const systemMessage: OpenAI.Responses.EasyInputMessage = {
      role: 'system',
      content: (getStoreSetting('topicNamingPrompt') as string) || i18n.t('prompts.title')
    }

    const userMessage: OpenAI.Responses.EasyInputMessage = {
      role: 'user',
      content: userMessageContent
    }

    const response = await this.sdk.responses.create({
      model: model.id,
      input: [systemMessage, userMessage],
      stream: false,
      max_output_tokens: 1000
    })
    return removeSpecialCharactersForTopicName(response.output_text.substring(0, 50))
  }

  public async summaryForSearch(messages: Message[], assistant: Assistant): Promise<string | null> {
    const model = getTopNamingModel() || assistant.model || getDefaultModel()
    const systemMessage: OpenAI.Responses.EasyInputMessage = {
      role: 'system',
      content: assistant.prompt
    }
    const messageContents = messages.map((m) => getMainTextContent(m))
    const userMessageContent = messageContents.join('\n')
    const userMessage: OpenAI.Responses.EasyInputMessage = {
      role: 'user',
      content: userMessageContent
    }
    const lastUserMessage = messages[messages.length - 1]
    const { abortController, cleanup } = this.createAbortController(lastUserMessage?.id)
    const { signal } = abortController

    const response = await this.sdk.responses
      .create(
        {
          model: model.id,
          input: [systemMessage, userMessage],
          stream: false,
          max_output_tokens: 1000
        },
        {
          signal,
          timeout: 20 * 1000
        }
      )
      .finally(cleanup)

    return response.output_text
  }

  /**
   *  Generate suggestions
   * @param messages - The messages
   * @param assistant - The assistant
   * @returns The suggestions
   */
  async suggestions(messages: Message[], assistant: Assistant): Promise<Suggestion[]> {
    const model = assistant.model

    if (!model) {
      return []
    }

    const userMessagesForApi = messages
      .filter((m) => m.role === 'user')
      .map((m) => ({
        role: m.role,
        content: getMainTextContent(m)
      }))

    const response: any = await this.sdk.request({
      method: 'post',
      path: '/advice_questions',
      body: {
        messages: userMessagesForApi,
        model: model.id,
        max_tokens: 0,
        temperature: 0,
        n: 0
      }
    })

    return response?.questions?.filter(Boolean)?.map((q: any) => ({ content: q })) || []
  }

  /**
   * Generate text
   * @param prompt - The prompt
   * @param content - The content
   * @returns The generated text
   */
  public async generateText({ prompt, content }: { prompt: string; content: string }): Promise<string> {
    const model = getDefaultModel()
    const response = await this.sdk.responses.create({
      model: model.id,
      stream: false,
      input: [
        { role: 'system', content: prompt },
        { role: 'user', content }
      ]
    })
    return response.output_text
  }

  /**
   * Check if the model is valid
   * @param model - The model
   * @param stream - Whether to use streaming interface
   * @returns The validity of the model
   */
  public async check(model: Model, stream: boolean): Promise<{ valid: boolean; error: Error | null }> {
    if (!model) {
      return { valid: false, error: new Error('No model found') }
    }
    if (stream) {
      const response = await this.sdk.responses.create({
        model: model.id,
        input: [{ role: 'user', content: 'hi' }],
        stream: true
      })
      let hasContent = false
      for await (const chunk of response) {
        if (chunk.type === 'response.output_text.delta') {
          hasContent = true
        }
      }
      if (hasContent) {
        return { valid: true, error: null }
      }
      throw new Error('Empty streaming response')
    } else {
      const response = await this.sdk.responses.create({
        model: model.id,
        input: [{ role: 'user', content: 'hi' }],
        stream: false
      })
      if (!response.output_text) {
        throw new Error('Empty response')
      }
      return { valid: true, error: null }
    }
  }

  /**
   * Get the models
   * @returns The models
   */
  public async models(): Promise<OpenAI.Models.Model[]> {
    try {
      const response = await this.sdk.models.list()
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
   * Generate an image
   * @param params - The parameters
   * @returns The generated image
   */
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

  public async generateImageByChat({ messages, assistant, onChunk }: CompletionsParams): Promise<void> {
    const defaultModel = getDefaultModel()
    const model = assistant.model || defaultModel
    // save image data from the last assistant message
    messages = addImageFileToContents(messages)
    const lastUserMessage = messages.findLast((m) => m.role === 'user')
    const lastAssistantMessage = messages.findLast((m) => m.role === 'assistant')
    if (!lastUserMessage) {
      return
    }

    const { abortController } = this.createAbortController(lastUserMessage?.id, true)
    const { signal } = abortController
    const content = getMainTextContent(lastUserMessage!)
    let response: OpenAI.Images.ImagesResponse | null = null
    let images: FileLike[] = []

    try {
      if (lastUserMessage) {
        const UserFiles = findImageBlocks(lastUserMessage)
        const validUserFiles = UserFiles.filter((f) => f.file) // Filter out files that are undefined first
        const userImages = await Promise.all(
          validUserFiles.map(async (f) => {
            // f.file is guaranteed to exist here due to the filter above
            const fileInfo = f.file!
            const binaryData = await FileManager.readBinaryImage(fileInfo)
            return await toFile(binaryData, fileInfo.origin_name || 'image.png', {
              type: 'image/png'
            })
          })
        )
        images = images.concat(userImages)
      }

      if (lastAssistantMessage) {
        const assistantFiles = findImageBlocks(lastAssistantMessage)
        const assistantImages = await Promise.all(
          assistantFiles.filter(Boolean).map(async (f) => {
            const base64Data = f?.url?.replace(/^data:image\/\w+;base64,/, '')
            if (!base64Data) return null
            const binary = atob(base64Data)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i)
            }
            return await toFile(bytes, 'assistant_image.png', {
              type: 'image/png'
            })
          })
        )
        images = images.concat(assistantImages.filter(Boolean) as FileLike[])
      }
      onChunk({
        type: ChunkType.IMAGE_CREATED
      })

      const start_time_millsec = new Date().getTime()

      if (images.length > 0) {
        response = await this.sdk.images.edit(
          {
            model: model.id,
            image: images,
            prompt: content || ''
          },
          {
            signal,
            timeout: 300_000
          }
        )
      } else {
        response = await this.sdk.images.generate(
          {
            model: model.id,
            prompt: content || '',
            response_format: model.id.includes('gpt-image-1') ? undefined : 'b64_json'
          },
          {
            signal,
            timeout: 300_000
          }
        )
      }

      onChunk({
        type: ChunkType.IMAGE_COMPLETE,
        image: {
          type: 'base64',
          images: response?.data?.map((item) => `data:image/png;base64,${item.b64_json}`) || []
        }
      })

      onChunk({
        type: ChunkType.BLOCK_COMPLETE,
        response: {
          usage: {
            completion_tokens: response.usage?.output_tokens || 0,
            prompt_tokens: response.usage?.input_tokens || 0,
            total_tokens: response.usage?.total_tokens || 0
          },
          metrics: {
            completion_tokens: response.usage?.output_tokens || 0,
            time_first_token_millsec: 0, // Non-streaming, first token time is not relevant
            time_completion_millsec: new Date().getTime() - start_time_millsec
          }
        }
      })
    } catch (error: any) {
      console.error('[generateImageByChat] error', error)
      onChunk({
        type: ChunkType.ERROR,
        error
      })
    }
  }

  /**
   * Get the embedding dimensions
   * @param model - The model
   * @returns The embedding dimensions
   */
  public async getEmbeddingDimensions(model: Model): Promise<number> {
    const data = await this.sdk.embeddings.create({
      model: model.id,
      input: 'hi'
    })
    return data.data[0].embedding.length
  }
}

export default class OpenAIProvider extends BaseOpenAiProvider {
  constructor(provider: Provider) {
    super(provider)
  }

  public convertMcpTools<T>(mcpTools: MCPTool[]) {
    return mcpToolsToOpenAIResponseTools(mcpTools) as T[]
  }

  public mcpToolCallResponseToMessage = (
    mcpToolResponse: MCPToolResponse,
    resp: MCPCallToolResponse,
    model: Model
  ): OpenAI.Responses.ResponseInputItem | undefined => {
    if ('toolUseId' in mcpToolResponse && mcpToolResponse.toolUseId) {
      return mcpToolCallResponseToOpenAIMessage(mcpToolResponse, resp, isVisionModel(model))
    } else if ('toolCallId' in mcpToolResponse && mcpToolResponse.toolCallId) {
      const toolCallOut: OpenAI.Responses.ResponseInputItem = {
        type: 'function_call_output',
        call_id: mcpToolResponse.toolCallId,
        output: JSON.stringify(resp.content)
      }
      return toolCallOut
    }
    return
  }
}
