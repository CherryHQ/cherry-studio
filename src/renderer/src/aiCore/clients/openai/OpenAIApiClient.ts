import { loggerService } from '@logger'
import { DEFAULT_MAX_TOKENS } from '@renderer/config/constant'
import {
  findTokenLimit,
  GEMINI_FLASH_MODEL_REGEX,
  getOpenAIWebSearchParams,
  getThinkModelType,
  isDoubaoThinkingAutoModel,
  isGPT5SeriesModel,
  isGrokReasoningModel,
  isNotSupportSystemMessageModel,
  isQwenAlwaysThinkModel,
  isQwenMTModel,
  isQwenReasoningModel,
  isReasoningModel,
  isSupportedReasoningEffortModel,
  isSupportedReasoningEffortOpenAIModel,
  isSupportedThinkingTokenClaudeModel,
  isSupportedThinkingTokenDoubaoModel,
  isSupportedThinkingTokenGeminiModel,
  isSupportedThinkingTokenHunyuanModel,
  isSupportedThinkingTokenModel,
  isSupportedThinkingTokenQwenModel,
  isSupportedThinkingTokenZhipuModel,
  isVisionModel,
  MODEL_SUPPORTED_REASONING_EFFORT
} from '@renderer/config/models'
import {
  isSupportArrayContentProvider,
  isSupportDeveloperRoleProvider,
  isSupportEnableThinkingProvider,
  isSupportStreamOptionsProvider
} from '@renderer/config/providers'
import { mapLanguageToQwenMTModel } from '@renderer/config/translate'
import { processPostsuffixQwen3Model, processReqMessages } from '@renderer/services/ModelMessageService'
import { estimateTextTokens } from '@renderer/services/TokenService'
// For Copilot token
import {
  Assistant,
  EFFORT_RATIO,
  FileTypes,
  MCPCallToolResponse,
  MCPTool,
  MCPToolResponse,
  Model,
  OpenAIServiceTier,
  Provider,
  ToolCallResponse,
  TranslateAssistant,
  WebSearchSource
} from '@renderer/types'
import { ChunkType, TextStartChunk, ThinkingStartChunk } from '@renderer/types/chunk'
import { Message } from '@renderer/types/newMessage'
import {
  OpenAISdkMessageParam,
  OpenAISdkParams,
  OpenAISdkRawChunk,
  OpenAISdkRawContentSource,
  OpenAISdkRawOutput,
  ReasoningEffortOptionalParams
} from '@renderer/types/sdk'
import { addImageFileToContents } from '@renderer/utils/formats'
import {
  isEnabledToolUse,
  mcpToolCallResponseToOpenAICompatibleMessage,
  mcpToolsToOpenAIChatTools,
  openAIToolsToMcpTool
} from '@renderer/utils/mcp-tools'
import { findFileBlocks, findImageBlocks } from '@renderer/utils/messageUtils/find'
import { t } from 'i18next'
import OpenAI, { AzureOpenAI } from 'openai'
import { ChatCompletionContentPart, ChatCompletionContentPartRefusal, ChatCompletionTool } from 'openai/resources'

import { GenericChunk } from '../../middleware/schemas'
import { RequestTransformer, ResponseChunkTransformer, ResponseChunkTransformerContext } from '../types'
import { OpenAIBaseClient } from './OpenAIBaseClient'

const logger = loggerService.withContext('OpenAIApiClient')

export class OpenAIAPIClient extends OpenAIBaseClient<
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

  override async createCompletions(
    payload: OpenAISdkParams,
    options?: OpenAI.RequestOptions
  ): Promise<OpenAISdkRawOutput> {
    const sdk = await this.getSdkInstance()
    // @ts-ignore - SDK参数可能有额外的字段
    return await sdk.chat.completions.create(payload, options)
  }

  /**
   * Get the reasoning effort for the assistant
   * @param assistant - The assistant
   * @param model - The model
   * @returns The reasoning effort
   */
  // Method for reasoning effort, moved from OpenAIProvider
  override getReasoningEffort(assistant: Assistant, model: Model): ReasoningEffortOptionalParams {
    if (this.provider.id === 'groq') {
      return {}
    }

    if (!isReasoningModel(model)) {
      return {}
    }
    const reasoningEffort = assistant?.settings?.reasoning_effort

    // Doubao 思考模式支持
    if (isSupportedThinkingTokenDoubaoModel(model)) {
      // reasoningEffort 为空，默认开启 enabled
      if (!reasoningEffort) {
        return { thinking: { type: 'disabled' } }
      }
      if (reasoningEffort === 'high') {
        return { thinking: { type: 'enabled' } }
      }
      if (reasoningEffort === 'auto' && isDoubaoThinkingAutoModel(model)) {
        return { thinking: { type: 'auto' } }
      }
      // 其他情况不带 thinking 字段
      return {}
    }

    if (isSupportedThinkingTokenZhipuModel(model)) {
      if (!reasoningEffort) {
        return { thinking: { type: 'disabled' } }
      }
      return { thinking: { type: 'enabled' } }
    }

    if (!reasoningEffort) {
      if (model.provider === 'openrouter') {
        // Don't disable reasoning for Gemini models that support thinking tokens
        if (isSupportedThinkingTokenGeminiModel(model) && !GEMINI_FLASH_MODEL_REGEX.test(model.id)) {
          return {}
        }
        // Don't disable reasoning for models that require it
        if (isGrokReasoningModel(model)) {
          return {}
        }
        return { reasoning: { enabled: false, exclude: true } }
      }

      if (
        isSupportEnableThinkingProvider(this.provider) &&
        (isSupportedThinkingTokenQwenModel(model) || isSupportedThinkingTokenHunyuanModel(model))
      ) {
        return { enable_thinking: false }
      }

      if (isSupportedThinkingTokenClaudeModel(model)) {
        return {}
      }

      if (isSupportedThinkingTokenGeminiModel(model)) {
        if (GEMINI_FLASH_MODEL_REGEX.test(model.id)) {
          return {
            extra_body: {
              google: {
                thinking_config: {
                  thinking_budget: 0
                }
              }
            }
          }
        }
        return {}
      }

      if (isSupportedThinkingTokenDoubaoModel(model)) {
        return { thinking: { type: 'disabled' } }
      }

      return {}
    }

    // reasoningEffort有效的情况
    const effortRatio = EFFORT_RATIO[reasoningEffort]
    const budgetTokens = Math.floor(
      (findTokenLimit(model.id)?.max! - findTokenLimit(model.id)?.min!) * effortRatio + findTokenLimit(model.id)?.min!
    )

    // OpenRouter models
    if (model.provider === 'openrouter') {
      if (isSupportedReasoningEffortModel(model) || isSupportedThinkingTokenModel(model)) {
        return {
          reasoning: {
            effort: reasoningEffort === 'auto' ? 'medium' : reasoningEffort
          }
        }
      }
    }

    // Qwen models
    if (isQwenReasoningModel(model)) {
      const thinkConfig = {
        enable_thinking:
          isQwenAlwaysThinkModel(model) || !isSupportEnableThinkingProvider(this.provider) ? undefined : true,
        thinking_budget: budgetTokens
      }
      if (this.provider.id === 'dashscope') {
        return {
          ...thinkConfig,
          incremental_output: true
        }
      }
      return thinkConfig
    }

    // Hunyuan models
    if (isSupportedThinkingTokenHunyuanModel(model) && isSupportEnableThinkingProvider(this.provider)) {
      return {
        enable_thinking: true
      }
    }

    // Grok models/Perplexity models/OpenAI models
    if (isSupportedReasoningEffortModel(model)) {
      // 检查模型是否支持所选选项
      const modelType = getThinkModelType(model)
      const supportedOptions = MODEL_SUPPORTED_REASONING_EFFORT[modelType]
      if (supportedOptions.includes(reasoningEffort)) {
        return {
          reasoning_effort: reasoningEffort
        }
      } else {
        // 如果不支持，fallback到第一个支持的值
        return {
          reasoning_effort: supportedOptions[0]
        }
      }
    }

    if (isSupportedThinkingTokenGeminiModel(model)) {
      if (reasoningEffort === 'auto') {
        return {
          extra_body: {
            google: {
              thinking_config: {
                thinking_budget: -1,
                include_thoughts: true
              }
            }
          }
        }
      }
      return {
        extra_body: {
          google: {
            thinking_config: {
              thinking_budget: budgetTokens,
              include_thoughts: true
            }
          }
        }
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

    // Doubao models
    if (isSupportedThinkingTokenDoubaoModel(model)) {
      if (assistant.settings?.reasoning_effort === 'high') {
        return {
          thinking: {
            type: 'enabled'
          }
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

    return !isSupportArrayContentProvider(this.provider)
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
        const fileContent = await (await window.api.file.read(file.id + file.ext, true)).trim()
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
      if ('function' in toolCall) {
        parsedArgs = JSON.parse(toolCall.function.arguments)
      }
    } catch {
      if ('function' in toolCall) {
        parsedArgs = toolCall.function.arguments
      }
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
      return mcpToolCallResponseToOpenAICompatibleMessage(
        mcpToolResponse,
        resp,
        isVisionModel(model),
        !isSupportArrayContentProvider(this.provider)
      )
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
    output: string | undefined,
    toolResults: OpenAISdkMessageParam[],
    toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]
  ): OpenAISdkMessageParam[] {
    if (!output && toolCalls.length === 0) {
      return [...currentReqMessages, ...toolResults]
    }

    const assistantMessage: OpenAISdkMessageParam = {
      role: 'assistant',
      content: output,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined
    }
    const newReqMessages = [...currentReqMessages, assistantMessage, ...toolResults]
    return newReqMessages
  }

  override estimateMessageTokens(message: OpenAISdkMessageParam): number {
    let sum = 0
    if (typeof message.content === 'string') {
      sum += estimateTextTokens(message.content)
    } else if (Array.isArray(message.content)) {
      sum += (message.content || [])
        .map((part: ChatCompletionContentPart | ChatCompletionContentPartRefusal) => {
          switch (part.type) {
            case 'text':
              return estimateTextTokens(part.text)
            case 'image_url':
              return estimateTextTokens(part.image_url.url)
            case 'input_audio':
              return estimateTextTokens(part.input_audio.data)
            case 'file':
              return estimateTextTokens(part.file.file_data || '')
            default:
              return 0
          }
        })
        .reduce((acc, curr) => acc + curr, 0)
    }
    if ('tool_calls' in message && message.tool_calls) {
      sum += message.tool_calls.reduce((acc, toolCall) => {
        if (toolCall.type === 'function' && 'function' in toolCall) {
          return acc + estimateTextTokens(JSON.stringify(toolCall.function.arguments))
        }
        return acc
      }, 0)
    }
    return sum
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
        metadata: Record<string, any>
      }> => {
        const { messages, mcpTools, maxTokens, enableWebSearch } = coreRequest
        let { streamOutput } = coreRequest

        // Qwen3商业版（思考模式）、Qwen3开源版、QwQ、QVQ只支持流式输出。
        if (isQwenReasoningModel(model)) {
          streamOutput = true
        }

        const extra_body: Record<string, any> = {}

        if (isQwenMTModel(model)) {
          const targetLanguage = (assistant as TranslateAssistant).targetLanguage
          extra_body.translation_options = {
            source_lang: 'auto',
            target_lang: mapLanguageToQwenMTModel(targetLanguage!)
          }
          if (!extra_body.translation_options.target_lang) {
            throw new Error(t('translate.error.not_supported', { language: targetLanguage?.value }))
          }
        }

        // 1. 处理系统消息
        let systemMessage = { role: 'system', content: assistant.prompt || '' }

        if (isSupportedReasoningEffortOpenAIModel(model)) {
          systemMessage = {
            role: isSupportDeveloperRoleProvider(this.provider) ? 'developer' : 'system',
            content: `Formatting re-enabled${systemMessage ? '\n' + systemMessage.content : ''}`
          }
        }

        if (model.id.includes('o1-mini') || model.id.includes('o1-preview')) {
          systemMessage.role = 'assistant'
        }

        // 2. 设置工具（必须在this.usesystemPromptForTools前面）
        const { tools } = this.setupToolsConfig({
          mcpTools: mcpTools,
          model,
          enableToolUse: isEnabledToolUse(assistant)
        })

        // 3. 处理用户消息
        const userMessages: OpenAISdkMessageParam[] = []
        if (typeof messages === 'string') {
          userMessages.push({ role: 'user', content: messages })
        } else {
          const processedMessages = addImageFileToContents(messages)
          for (const message of processedMessages) {
            userMessages.push(await this.convertMessageToSdkParam(message, model))
          }
        }

        const lastUserMsg = userMessages.findLast((m) => m.role === 'user')
        if (
          lastUserMsg &&
          isSupportedThinkingTokenQwenModel(model) &&
          !isSupportEnableThinkingProvider(this.provider)
        ) {
          const postsuffix = '/no_think'
          const qwenThinkModeEnabled = assistant.settings?.qwenThinkMode === true
          const currentContent = lastUserMsg.content

          lastUserMsg.content = processPostsuffixQwen3Model(currentContent, postsuffix, qwenThinkModeEnabled) as any
        }

        // 4. 最终请求消息
        let reqMessages: OpenAISdkMessageParam[]
        if (!systemMessage.content || isNotSupportSystemMessageModel(model)) {
          reqMessages = [...userMessages]
        } else {
          reqMessages = [systemMessage, ...userMessages].filter(Boolean) as OpenAISdkMessageParam[]
        }

        reqMessages = processReqMessages(model, reqMessages)

        // 5. 创建通用参数
        // Create the appropriate parameters object based on whether streaming is enabled
        // Note: Some providers like Mistral don't support stream_options
        const shouldIncludeStreamOptions = streamOutput && isSupportStreamOptionsProvider(this.provider)

        const reasoningEffort = this.getReasoningEffort(assistant, model)

        // minimal cannot be used with web_search tool
        if (isGPT5SeriesModel(model) && reasoningEffort.reasoning_effort === 'minimal' && enableWebSearch) {
          reasoningEffort.reasoning_effort = 'low'
        }

        const commonParams: OpenAISdkParams = {
          model: model.id,
          messages:
            isRecursiveCall && recursiveSdkMessages && recursiveSdkMessages.length > 0
              ? recursiveSdkMessages
              : reqMessages,
          temperature: this.getTemperature(assistant, model),
          top_p: this.getTopP(assistant, model),
          max_tokens: maxTokens,
          tools: tools.length > 0 ? tools : undefined,
          stream: streamOutput,
          ...(shouldIncludeStreamOptions ? { stream_options: { include_usage: true } } : {}),
          // groq 有不同的 service tier 配置，不符合 openai 接口类型
          service_tier: this.getServiceTier(model) as OpenAIServiceTier,
          ...this.getProviderSpecificParameters(assistant, model),
          ...reasoningEffort,
          ...getOpenAIWebSearchParams(model, enableWebSearch),
          // OpenRouter usage tracking
          ...(this.provider.id === 'openrouter' ? { usage: { include: true } } : {}),
          ...(isQwenMTModel(model) ? extra_body : {}),
          // 只在对话场景下应用自定义参数，避免影响翻译、总结等其他业务逻辑
          // 注意：用户自定义参数总是应该覆盖其他参数
          ...(coreRequest.callType === 'chat' ? this.getCustomParameters(assistant) : {})
        }

        const timeout = this.getTimeout(model)

        return { payload: commonParams, messages: reqMessages, metadata: { timeout } }
      }
    }
  }

  // 在RawSdkChunkToGenericChunkMiddleware中使用
  getResponseChunkTransformer(): ResponseChunkTransformer<OpenAISdkRawChunk> {
    let hasBeenCollectedWebSearch = false
    let hasEmittedWebSearchInProgress = false
    const collectWebSearchData = (
      chunk: OpenAISdkRawChunk,
      contentSource: OpenAISdkRawContentSource,
      context: ResponseChunkTransformerContext
    ) => {
      if (hasBeenCollectedWebSearch) {
        return
      }
      // OpenAI annotations
      // @ts-ignore - annotations may not be in standard type definitions
      const annotations = contentSource.annotations || chunk.annotations
      if (annotations && annotations.length > 0 && annotations[0].type === 'url_citation') {
        hasBeenCollectedWebSearch = true
        return {
          results: annotations,
          source: WebSearchSource.OPENAI
        }
      }

      // Grok citations
      // @ts-ignore - citations may not be in standard type definitions
      if (context.provider?.id === 'grok' && chunk.citations) {
        hasBeenCollectedWebSearch = true
        return {
          // @ts-ignore - citations may not be in standard type definitions
          results: chunk.citations,
          source: WebSearchSource.GROK
        }
      }

      // Perplexity citations
      // @ts-ignore - citations may not be in standard type definitions
      if (context.provider?.id === 'perplexity' && chunk.search_results && chunk.search_results.length > 0) {
        hasBeenCollectedWebSearch = true
        return {
          // @ts-ignore - citations may not be in standard type definitions
          results: chunk.search_results,
          source: WebSearchSource.PERPLEXITY
        }
      }

      // OpenRouter citations
      // @ts-ignore - citations may not be in standard type definitions
      if (context.provider?.id === 'openrouter' && chunk.citations && chunk.citations.length > 0) {
        hasBeenCollectedWebSearch = true
        return {
          // @ts-ignore - citations may not be in standard type definitions
          results: chunk.citations,
          source: WebSearchSource.OPENROUTER
        }
      }

      // Zhipu web search
      // @ts-ignore - web_search may not be in standard type definitions
      if (context.provider?.id === 'zhipu' && chunk.web_search) {
        hasBeenCollectedWebSearch = true
        return {
          // @ts-ignore - web_search may not be in standard type definitions
          results: chunk.web_search,
          source: WebSearchSource.ZHIPU
        }
      }

      // Hunyuan web search
      // @ts-ignore - search_info may not be in standard type definitions
      if (context.provider?.id === 'hunyuan' && chunk.search_info?.search_results) {
        hasBeenCollectedWebSearch = true
        return {
          // @ts-ignore - search_info may not be in standard type definitions
          results: chunk.search_info.search_results,
          source: WebSearchSource.HUNYUAN
        }
      }

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

    const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = []
    let isFinished = false
    let lastUsageInfo: any = null
    let hasFinishReason = false // Track if we've seen a finish_reason

    /**
     * 统一的完成信号发送逻辑
     * - 有 finish_reason 时
     * - 无 finish_reason 但是流正常结束时
     */
    const emitCompletionSignals = (controller: TransformStreamDefaultController<GenericChunk>) => {
      if (isFinished) return

      if (toolCalls.length > 0) {
        controller.enqueue({
          type: ChunkType.MCP_TOOL_CREATED,
          tool_calls: toolCalls
        })
      }

      const usage = lastUsageInfo || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }

      controller.enqueue({
        type: ChunkType.LLM_RESPONSE_COMPLETE,
        response: { usage }
      })

      // 防止重复发送
      isFinished = true
    }

    let isThinking = false
    let accumulatingText = false
    return (context: ResponseChunkTransformerContext) => ({
      async transform(chunk: OpenAISdkRawChunk, controller: TransformStreamDefaultController<GenericChunk>) {
        const isOpenRouter = context.provider?.id === 'openrouter'

        // 持续更新usage信息
        logger.silly('chunk', chunk)
        if (chunk.usage) {
          const usage = chunk.usage as any // OpenRouter may include additional fields like cost
          lastUsageInfo = {
            prompt_tokens: usage.prompt_tokens || 0,
            completion_tokens: usage.completion_tokens || 0,
            total_tokens: usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
            // Handle OpenRouter specific cost fields
            ...(usage.cost !== undefined ? { cost: usage.cost } : {})
          }

          // For OpenRouter, if we've seen finish_reason and now have usage, emit completion signals
          if (isOpenRouter && hasFinishReason && !isFinished) {
            emitCompletionSignals(controller)
            return
          }
        }

        // For OpenRouter, if this chunk only contains usage without choices, emit completion signals
        if (isOpenRouter && chunk.usage && (!chunk.choices || chunk.choices.length === 0)) {
          if (!isFinished) {
            emitCompletionSignals(controller)
          }
          return
        }

        if (typeof chunk === 'string') {
          try {
            chunk = JSON.parse(chunk)
          } catch (error) {
            logger.error('invalid chunk', { chunk, error })
            throw new Error(t('error.chat.chunk.non_json'))
          }
        }

        // 处理chunk
        if ('choices' in chunk && chunk.choices && chunk.choices.length > 0) {
          for (const choice of chunk.choices) {
            if (!choice) continue

            // 对于流式响应，使用 delta；对于非流式响应，使用 message。
            // 然而某些 OpenAI 兼容平台在非流式请求时会错误地返回一个空对象的 delta 字段。
            // 如果 delta 为空对象或content为空，应当忽略它并回退到 message，避免造成内容缺失。
            let contentSource: OpenAISdkRawContentSource | null = null
            if (
              'delta' in choice &&
              choice.delta &&
              Object.keys(choice.delta).length > 0 &&
              (!('content' in choice.delta) ||
                (choice.delta.tool_calls && choice.delta.tool_calls.length > 0) ||
                (typeof choice.delta.content === 'string' && choice.delta.content !== '') ||
                (typeof (choice.delta as any).reasoning_content === 'string' &&
                  (choice.delta as any).reasoning_content !== '') ||
                (typeof (choice.delta as any).reasoning === 'string' && (choice.delta as any).reasoning !== ''))
            ) {
              contentSource = choice.delta
            } else if ('message' in choice) {
              contentSource = choice.message
            }

            // 状态管理
            if (!contentSource?.content) {
              accumulatingText = false
            }
            // @ts-ignore - reasoning_content is not in standard OpenAI types but some providers use it
            if (!contentSource?.reasoning_content && !contentSource?.reasoning) {
              isThinking = false
            }

            if (!contentSource) {
              if ('finish_reason' in choice && choice.finish_reason) {
                // For OpenRouter, don't emit completion signals immediately after finish_reason
                // Wait for the usage chunk that comes after
                if (isOpenRouter) {
                  hasFinishReason = true
                  // If we already have usage info, emit completion signals now
                  if (lastUsageInfo && lastUsageInfo.total_tokens > 0) {
                    emitCompletionSignals(controller)
                  }
                } else {
                  // For other providers, emit completion signals immediately
                  emitCompletionSignals(controller)
                }
              }
              continue
            }

            const webSearchData = collectWebSearchData(chunk, contentSource, context)
            if (webSearchData) {
              // 如果还未发送搜索进度事件，先发送进度事件
              if (!hasEmittedWebSearchInProgress) {
                controller.enqueue({
                  type: ChunkType.LLM_WEB_SEARCH_IN_PROGRESS
                })
                hasEmittedWebSearchInProgress = true
              }
              controller.enqueue({
                type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
                llm_web_search: webSearchData
              })
            }

            // 处理推理内容 (e.g. from OpenRouter DeepSeek-R1)
            // @ts-ignore - reasoning_content is not in standard OpenAI types but some providers use it
            const reasoningText = contentSource.reasoning_content || contentSource.reasoning
            if (reasoningText) {
              // logger.silly('since reasoningText is trusy, try to enqueue THINKING_START AND THINKING_DELTA')
              if (!isThinking) {
                // logger.silly('since isThinking is falsy, try to enqueue THINKING_START')
                controller.enqueue({
                  type: ChunkType.THINKING_START
                } as ThinkingStartChunk)
                isThinking = true
              }

              // logger.silly('enqueue THINKING_DELTA')
              controller.enqueue({
                type: ChunkType.THINKING_DELTA,
                text: reasoningText
              })
            } else {
              isThinking = false
            }

            // 处理文本内容
            if (contentSource.content) {
              // logger.silly('since contentSource.content is trusy, try to enqueue TEXT_START and TEXT_DELTA')
              if (!accumulatingText) {
                // logger.silly('enqueue TEXT_START')
                controller.enqueue({
                  type: ChunkType.TEXT_START
                } as TextStartChunk)
                accumulatingText = true
              }
              // logger.silly('enqueue TEXT_DELTA')
              controller.enqueue({
                type: ChunkType.TEXT_DELTA,
                text: contentSource.content
              })
            } else {
              accumulatingText = false
            }

            // 处理工具调用
            if (contentSource.tool_calls) {
              for (const toolCall of contentSource.tool_calls) {
                if ('index' in toolCall) {
                  const { id, index, function: fun } = toolCall
                  if (fun?.name) {
                    toolCalls[index] = {
                      id: id || '',
                      function: {
                        name: fun.name,
                        arguments: fun.arguments || ''
                      },
                      type: 'function'
                    }
                  } else if (fun?.arguments) {
                    if (toolCalls[index] && toolCalls[index].type === 'function' && 'function' in toolCalls[index]) {
                      toolCalls[index].function.arguments += fun.arguments
                    }
                  }
                } else {
                  toolCalls.push(toolCall)
                }
              }
            }

            // 处理finish_reason，发送流结束信号
            if ('finish_reason' in choice && choice.finish_reason) {
              logger.debug(`Stream finished with reason: ${choice.finish_reason}`)
              const webSearchData = collectWebSearchData(chunk, contentSource, context)
              if (webSearchData) {
                // 如果还未发送搜索进度事件，先发送进度事件
                if (!hasEmittedWebSearchInProgress) {
                  controller.enqueue({
                    type: ChunkType.LLM_WEB_SEARCH_IN_PROGRESS
                  })
                  hasEmittedWebSearchInProgress = true
                }
                controller.enqueue({
                  type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
                  llm_web_search: webSearchData
                })
              }

              // For OpenRouter, don't emit completion signals immediately after finish_reason
              // Wait for the usage chunk that comes after
              if (isOpenRouter) {
                hasFinishReason = true
                // If we already have usage info, emit completion signals now
                if (lastUsageInfo && lastUsageInfo.total_tokens > 0) {
                  emitCompletionSignals(controller)
                }
              } else {
                // For other providers, emit completion signals immediately
                emitCompletionSignals(controller)
              }
            }
          }
        }
      },

      // 流正常结束时，检查是否需要发送完成信号
      flush(controller) {
        if (isFinished) return

        logger.debug('Stream ended without finish_reason, emitting fallback completion signals')
        emitCompletionSignals(controller)
      }
    })
  }
}
