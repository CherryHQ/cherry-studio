import { DEFAULT_MAX_TOKENS } from '@renderer/config/constant'
import {
  findTokenLimit,
  getOpenAIWebSearchParams,
  isClaudeReasoningModel,
  isOpenAIReasoningModel,
  isReasoningModel,
  isSupportedReasoningEffortGrokModel,
  isSupportedReasoningEffortModel,
  isSupportedReasoningEffortOpenAIModel,
  isSupportedThinkingTokenClaudeModel,
  isSupportedThinkingTokenGeminiModel,
  isSupportedThinkingTokenModel,
  isSupportedThinkingTokenQwenModel,
  isVisionModel
} from '@renderer/config/models'
import { getAssistantSettings } from '@renderer/services/AssistantService'
import {
  filterContextMessages,
  filterEmptyMessages,
  filterUserRoleStartMessages
} from '@renderer/services/MessagesService'
import { processPostsuffixQwen3Model, processReqMessages } from '@renderer/services/ModelMessageService'
import store from '@renderer/store' // For Copilot token
import {
  Assistant,
  EFFORT_RATIO,
  FileTypes,
  MCPCallToolResponse,
  MCPTool,
  MCPToolResponse,
  Model,
  Provider,
  ToolCallResponse,
  WebSearchSource
} from '@renderer/types'
import { ChunkType } from '@renderer/types/chunk'
import { Message } from '@renderer/types/newMessage'
import {
  OpenAISdkMessageParam,
  OpenAISdkParams,
  OpenAISdkRawChunk,
  OpenAISdkRawContentSource,
  OpenAISdkRawOutput,
  ReasoningEffortOptionalParams,
  SdkToolCall
} from '@renderer/types/sdk'
import { formatApiHost } from '@renderer/utils/api'
import { addImageFileToContents } from '@renderer/utils/formats'
import {
  isEnabledToolUse,
  mcpToolCallResponseToOpenAICompatibleMessage,
  mcpToolsToOpenAIChatTools,
  openAIToolsToMcpTool
} from '@renderer/utils/mcp-tools'
import { findFileBlocks, findImageBlocks } from '@renderer/utils/messageUtils/find'
import { buildSystemPrompt } from '@renderer/utils/prompt'
import { takeRight } from 'lodash'
import OpenAI, { AzureOpenAI } from 'openai'
import { ChatCompletionContentPart, ChatCompletionTool } from 'openai/resources'
import { Stream } from 'openai/streaming'

import { GenericChunk } from '../../../middleware/schemas'
import { BaseApiClient } from '../BaseApiClient'
import {
  RawStreamListener,
  RequestTransformer,
  ResponseChunkTransformer,
  ResponseChunkTransformerContext
} from '../types'

export class OpenAIAPIClient extends BaseApiClient<
  OpenAI | AzureOpenAI,
  OpenAISdkParams,
  OpenAISdkRawOutput,
  OpenAISdkRawChunk,
  OpenAISdkMessageParam,
  OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  ChatCompletionTool
> {
  constructor(provider: Provider) {
    super(provider)
  }

  // 仅适用于openai
  override getBaseURL(): string {
    const host = this.provider.apiHost
    return formatApiHost(host)
  }

  override async createCompletions(
    payload: OpenAISdkParams,
    options?: OpenAI.RequestOptions
  ): Promise<OpenAISdkRawOutput> {
    const sdk = await this.getSdkInstance()
    // @ts-ignore - SDK参数可能有额外的字段
    return sdk.chat.completions.create(payload, options)
  }

  override async getSdkInstance() {
    if (this.sdkInstance) {
      return this.sdkInstance
    }

    if (this.provider.id === 'copilot') {
      const defaultHeaders = store.getState().copilot.defaultHeaders
      const { token } = await window.api.copilot.getToken(defaultHeaders)
      this.provider.apiKey = token // Update API key for each call to copilot
    }

    if (this.provider.id === 'azure-openai' || this.provider.type === 'azure-openai') {
      this.sdkInstance = new AzureOpenAI({
        dangerouslyAllowBrowser: true,
        apiKey: this.provider.apiKey,
        apiVersion: this.provider.apiVersion,
        endpoint: this.provider.apiHost
      })
    } else {
      this.sdkInstance = new OpenAI({
        dangerouslyAllowBrowser: true,
        apiKey: this.provider.apiKey,
        baseURL: this.getBaseURL(),
        defaultHeaders: {
          ...this.defaultHeaders(),
          ...(this.provider.id === 'copilot' ? { 'editor-version': 'vscode/1.97.2' } : {}),
          ...(this.provider.id === 'copilot' ? { 'copilot-vision-request': 'true' } : {})
        }
      })
    }
    return this.sdkInstance
  }

  override getTemperature(assistant: Assistant, model: Model): number | undefined {
    if (isOpenAIReasoningModel(model) || (assistant.settings?.reasoning_effort && isClaudeReasoningModel(model))) {
      return undefined
    }
    return assistant.settings?.temperature
  }

  override getTopP(assistant: Assistant, model: Model): number | undefined {
    if (isOpenAIReasoningModel(model) || (assistant.settings?.reasoning_effort && isClaudeReasoningModel(model))) {
      return undefined
    }
    return assistant.settings?.topP
  }

  /**
   * Get the provider specific parameters for the assistant
   * @param assistant - The assistant
   * @param model - The model
   * @returns The provider specific parameters
   */
  private getProviderSpecificParameters(assistant: Assistant, model: Model) {
    const { maxTokens } = getAssistantSettings(assistant)

    if (this.provider.id === 'openrouter') {
      if (model.id.includes('deepseek-r1')) {
        return {
          include_reasoning: true
        }
      }
    }

    if (isOpenAIReasoningModel(model)) {
      return {
        max_tokens: undefined,
        max_completion_tokens: maxTokens
      }
    }

    return {}
  }

  /**
   * Get the reasoning effort for the assistant
   * @param assistant - The assistant
   * @param model - The model
   * @returns The reasoning effort
   */
  // Method for reasoning effort, moved from OpenAIProvider
  private getReasoningEffort(assistant: Assistant, model: Model): ReasoningEffortOptionalParams {
    if (this.provider.id === 'groq') {
      return {}
    }

    if (!isReasoningModel(model)) {
      return {}
    }
    const reasoningEffort = assistant?.settings?.reasoning_effort
    if (!reasoningEffort) {
      if (isSupportedThinkingTokenQwenModel(model)) {
        return { enable_thinking: false }
      }

      if (isSupportedThinkingTokenClaudeModel(model)) {
        return { thinking: { type: 'disabled' } }
      }

      if (isSupportedThinkingTokenGeminiModel(model)) {
        // openrouter没有提供一个不推理的选项，先隐藏
        if (this.provider.id === 'openrouter') {
          return { reasoning: { max_tokens: 0, exclude: true } }
        }
        return {
          reasoning_effort: 'none'
        }
      }

      return {}
    }
    const effortRatio = EFFORT_RATIO[reasoningEffort]
    const budgetTokens = Math.floor(
      (findTokenLimit(model.id)?.max! - findTokenLimit(model.id)?.min!) * effortRatio + findTokenLimit(model.id)?.min!
    )

    // OpenRouter models
    if (model.provider === 'openrouter') {
      if (isSupportedReasoningEffortModel(model) || isSupportedThinkingTokenModel(model)) {
        return {
          reasoning: {
            effort: assistant?.settings?.reasoning_effort === 'auto' ? 'medium' : assistant?.settings?.reasoning_effort
          }
        }
      }
    }

    // Qwen models
    if (isSupportedThinkingTokenQwenModel(model)) {
      return {
        enable_thinking: true,
        thinking_budget: budgetTokens
      }
    }

    // Grok models
    if (isSupportedReasoningEffortGrokModel(model)) {
      return {
        reasoning_effort: assistant?.settings?.reasoning_effort
      }
    }

    // OpenAI models
    if (isSupportedReasoningEffortOpenAIModel(model) || isSupportedThinkingTokenGeminiModel(model)) {
      return {
        reasoning_effort: assistant?.settings?.reasoning_effort
      }
    }

    // Claude models
    if (isSupportedThinkingTokenClaudeModel(model)) {
      const maxTokens = assistant.settings?.maxTokens
      return {
        thinking: {
          type: 'enabled',
          budget_tokens: Math.floor(
            Math.max(1024, Math.min(budgetTokens, (maxTokens || DEFAULT_MAX_TOKENS) * effortRatio))
          )
        }
      }
    }

    // Default case: no special thinking settings
    return {}
  }

  /**
   * Check if the provider does not support files
   * @returns True if the provider does not support files, false otherwise
   */
  private get isNotSupportFiles() {
    if (this.provider?.isNotSupportArrayContent) {
      return true
    }

    const providers = ['deepseek', 'baichuan', 'minimax', 'xirang']

    return providers.includes(this.provider.id)
  }

  /**
   * Get the message parameter
   * @param message - The message
   * @param model - The model
   * @returns The message parameter
   */
  public async convertMessageToSdkParam(message: Message, model: Model): Promise<OpenAISdkMessageParam> {
    const isVision = isVisionModel(model)
    const content = await this.getMessageContent(message)
    const fileBlocks = findFileBlocks(message)
    const imageBlocks = findImageBlocks(message)

    if (fileBlocks.length === 0 && imageBlocks.length === 0) {
      return {
        role: message.role === 'system' ? 'user' : message.role,
        content
      } as OpenAISdkMessageParam
    }

    // If the model does not support files, extract the file content
    if (this.isNotSupportFiles) {
      const fileContent = await this.extractFileContent(message)

      return {
        role: message.role === 'system' ? 'user' : message.role,
        content: content + '\n\n---\n\n' + fileContent
      } as OpenAISdkMessageParam
    }

    // If the model supports files, add the file content to the message
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
      const file = fileBlock.file
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
    } as OpenAISdkMessageParam
  }

  public convertMcpToolsToSdkTools(mcpTools: MCPTool[]): ChatCompletionTool[] {
    return mcpToolsToOpenAIChatTools(mcpTools)
  }

  public convertSdkToolCallToMcp(
    toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
    mcpTools: MCPTool[]
  ): MCPTool | undefined {
    return openAIToolsToMcpTool(mcpTools, toolCall)
  }

  public convertSdkToolCallToMcpToolResponse(
    toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
    mcpTool: MCPTool
  ): ToolCallResponse {
    let parsedArgs: any
    try {
      parsedArgs = JSON.parse(toolCall.function.arguments)
    } catch {
      parsedArgs = toolCall.function.arguments
    }
    return {
      id: toolCall.id,
      toolCallId: toolCall.id,
      tool: mcpTool,
      arguments: parsedArgs,
      status: 'pending'
    } as ToolCallResponse
  }

  public convertMcpToolResponseToSdkMessageParam(
    mcpToolResponse: MCPToolResponse,
    resp: MCPCallToolResponse,
    model: Model
  ): OpenAISdkMessageParam | undefined {
    if ('toolUseId' in mcpToolResponse && mcpToolResponse.toolUseId) {
      // This case is for Anthropic/Claude like tool usage, OpenAI uses tool_call_id
      // For OpenAI, we primarily expect toolCallId. This might need adjustment if mixing provider concepts.
      return mcpToolCallResponseToOpenAICompatibleMessage(mcpToolResponse, resp, isVisionModel(model))
    } else if ('toolCallId' in mcpToolResponse && mcpToolResponse.toolCallId) {
      return {
        role: 'tool',
        tool_call_id: mcpToolResponse.toolCallId,
        content: JSON.stringify(resp.content)
      } as OpenAI.Chat.Completions.ChatCompletionToolMessageParam
    }
    return undefined
  }

  public buildSdkMessages(
    currentReqMessages: OpenAISdkMessageParam[],
    output: string,
    toolResults: OpenAISdkMessageParam[],
    toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]
  ): OpenAISdkMessageParam[] {
    const assistantMessage: OpenAISdkMessageParam = {
      role: 'assistant',
      content: output,
      tool_calls: toolCalls
    }
    const newReqMessages = [...currentReqMessages, assistantMessage, ...(toolResults || [])]
    return newReqMessages
  }

  public extractMessagesFromSdkPayload(sdkPayload: OpenAISdkParams): OpenAISdkMessageParam[] {
    return sdkPayload.messages || []
  }

  getRequestTransformer(): RequestTransformer<OpenAISdkParams, OpenAISdkMessageParam> {
    return {
      transform: async (
        coreRequest,
        assistant,
        model,
        isRecursiveCall,
        recursiveSdkMessages
      ): Promise<{
        payload: OpenAISdkParams
        messages: OpenAISdkMessageParam[]
        processedMessages: Message[]
        metadata: Record<string, any>
      }> => {
        const { messages, mcpTools, maxTokens, streamOutput, onFilterMessages } = coreRequest

        const { contextCount } = getAssistantSettings(assistant)

        const processedMessages = addImageFileToContents(messages)

        let systemMessage = { role: 'system', content: assistant.prompt || '' }

        if (isSupportedReasoningEffortOpenAIModel(model)) {
          systemMessage = {
            role: 'developer',
            content: `Formatting re-enabled${systemMessage ? '\n' + systemMessage.content : ''}`
          }
        }

        const { tools } = this.setupToolsConfig({
          mcpTools: mcpTools,
          model,
          enableToolUse: isEnabledToolUse(assistant)
        })

        if (this.useSystemPromptForTools) {
          systemMessage.content = buildSystemPrompt(systemMessage.content || '', mcpTools)
        }

        const userMessages: OpenAISdkMessageParam[] = []

        const _messages = filterUserRoleStartMessages(
          filterEmptyMessages(filterContextMessages(takeRight(processedMessages, contextCount + 1)))
        )

        onFilterMessages(_messages)
        for (const message of messages) {
          userMessages.push(await this.convertMessageToSdkParam(message, model))
        }

        const lastUserMsg = userMessages.findLast((m) => m.role === 'user')
        if (lastUserMsg && isSupportedThinkingTokenQwenModel(model)) {
          const postsuffix = '/no_think'
          const qwenThinkModeEnabled = assistant.settings?.qwenThinkMode === true
          const currentContent = lastUserMsg.content

          lastUserMsg.content = processPostsuffixQwen3Model(currentContent, postsuffix, qwenThinkModeEnabled) as any
        }

        let reqMessages: OpenAISdkMessageParam[]
        if (!systemMessage.content) {
          reqMessages = [...userMessages]
        } else {
          reqMessages = [systemMessage, ...userMessages].filter(Boolean) as OpenAISdkMessageParam[]
        }

        reqMessages = processReqMessages(model, reqMessages)

        // Create common parameters that will be used in both streaming and non-streaming cases
        const commonParams = {
          model: model.id,
          messages:
            isRecursiveCall && recursiveSdkMessages && recursiveSdkMessages.length > 0
              ? recursiveSdkMessages
              : reqMessages,
          temperature: this.getTemperature(assistant, model),
          top_p: this.getTopP(assistant, model),
          max_tokens: maxTokens,
          tools: tools,
          service_tier: this.getServiceTier(model),
          ...this.getProviderSpecificParameters(assistant, model),
          ...this.getReasoningEffort(assistant, model),
          ...this.getCustomParameters(assistant),
          ...getOpenAIWebSearchParams(assistant, model)
        }

        // Create the appropriate parameters object based on whether streaming is enabled
        const sdkParams: OpenAISdkParams = streamOutput
          ? {
              ...commonParams,
              stream: true
            }
          : {
              ...commonParams,
              stream: false
            }

        const timeout = this.getTimeout(model)

        return { payload: sdkParams, messages: reqMessages, processedMessages, metadata: { timeout } }
      }
    }
  }

  // 在RawSdkChunkToGenericChunkMiddleware中使用
  getResponseChunkTransformer = (): ResponseChunkTransformer<OpenAISdkRawChunk> => {
    const collectWebSearchData = (
      chunk: OpenAISdkRawChunk,
      contentSource: OpenAISdkRawContentSource,
      context: ResponseChunkTransformerContext
    ) => {
      // OpenAI annotations
      // @ts-ignore - annotations may not be in standard type definitions
      const annotations = contentSource.annotations || chunk.annotations
      if (annotations) {
        return {
          results: annotations,
          source: WebSearchSource.OPENAI_RESPONSE
        }
      }

      // Grok citations
      // @ts-ignore - citations may not be in standard type definitions
      if (context.provider?.id === 'grok' && chunk.citations) {
        return {
          // @ts-ignore - citations may not be in standard type definitions
          results: chunk.citations,
          source: WebSearchSource.GROK
        }
      }

      // Perplexity citations
      // @ts-ignore - citations may not be in standard type definitions
      if (context.provider?.id === 'perplexity' && chunk.citations) {
        return {
          // @ts-ignore - citations may not be in standard type definitions
          results: chunk.citations,
          source: WebSearchSource.PERPLEXITY
        }
      }

      // OpenRouter citations
      // @ts-ignore - citations may not be in standard type definitions
      if (context.provider?.id === 'openrouter' && chunk.citations) {
        return {
          // @ts-ignore - citations may not be in standard type definitions
          results: chunk.citations,
          source: WebSearchSource.OPENROUTER
        }
      }

      // Zhipu web search
      // @ts-ignore - web_search may not be in standard type definitions
      if (context.provider?.id === 'zhipu' && chunk.web_search) {
        return {
          // @ts-ignore - web_search may not be in standard type definitions
          results: chunk.web_search,
          source: WebSearchSource.ZHIPU
        }
      }

      // Hunyuan web search
      // @ts-ignore - search_info may not be in standard type definitions
      if (context.provider?.id === 'hunyuan' && chunk.search_info?.search_results) {
        return {
          // @ts-ignore - search_info may not be in standard type definitions
          results: chunk.search_info.search_results,
          source: WebSearchSource.HUNYUAN
        }
      }

      // TODO: 放到GeminiApiClient中
      // Gemini grounding metadata
      // @ts-ignore - groundingMetadata may not be in standard type definitions
      // const groundingMetadata = contentSource.groundingMetadata || chunk.groundingMetadata
      // if (context.provider?.id === 'gemini' && groundingMetadata) {
      //   return {
      //     results: groundingMetadata,
      //     source: 'gemini' as const
      //   }
      // }

      // TODO: 放到AnthropicApiClient中
      // // Other providers...
      // // @ts-ignore - web_search may not be in standard type definitions
      // if (chunk.web_search) {
      //   const sourceMap: Record<string, string> = {
      //     openai: 'openai',
      //     anthropic: 'anthropic',
      //     qwenlm: 'qwen'
      //   }
      //   const source = sourceMap[context.provider?.id] || 'openai_response'
      //   return {
      //     results: chunk.web_search,
      //     source: source as const
      //   }
      // }

      return null
    }

    return (context: ResponseChunkTransformerContext) => ({
      async transform(chunk: OpenAISdkRawChunk, controller: TransformStreamDefaultController<GenericChunk>) {
        // 处理chunk
        if ('choices' in chunk && chunk.choices && chunk.choices.length > 0) {
          const choice = chunk.choices[0]

          if (!choice) return

          // 对于流式响应，使用delta；对于非流式响应，使用message
          const contentSource: OpenAISdkRawContentSource | null =
            'delta' in choice ? choice.delta : 'message' in choice ? choice.message : null

          if (!contentSource) return

          // 处理文本内容
          if (contentSource.content) {
            controller.enqueue({
              type: ChunkType.TEXT_DELTA,
              text: contentSource.content
            })
          }

          // 处理工具调用
          if (contentSource.tool_calls) {
            controller.enqueue({
              type: ChunkType.MCP_TOOL_CREATED,
              tool_calls: contentSource.tool_calls as SdkToolCall[]
            })
          }

          // 处理推理内容 (e.g. from OpenRouter DeepSeek-R1)
          // @ts-ignore - reasoning_content is not in standard OpenAI types but some providers use it
          const reasoningText = contentSource.reasoning_content || contentSource.reasoning
          if (reasoningText) {
            controller.enqueue({
              type: ChunkType.THINKING_DELTA,
              text: reasoningText
            })
          }

          // 处理finish_reason，发送流结束信号
          if ('finish_reason' in choice && choice.finish_reason) {
            console.log(`[OpenAIApiClient] Stream finished with reason: ${choice.finish_reason}`)
            const webSearchData = collectWebSearchData(chunk, contentSource, context)
            if (webSearchData) {
              controller.enqueue({
                type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
                llm_web_search: webSearchData
              })
            }
            controller.enqueue({
              type: ChunkType.LLM_RESPONSE_COMPLETE
            })
          }
        }
      }
    })
  }

  /**
   * OpenAI专用的原始流监听器
   * 处理OpenAI Stream对象的特定事件
   */
  override attachRawStreamListener(
    rawOutput: OpenAISdkRawOutput,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _listener: RawStreamListener<OpenAISdkRawChunk>
  ): OpenAISdkRawOutput {
    if (rawOutput instanceof Stream) {
      return rawOutput
    }
    return rawOutput
  }
}
