import { loggerService } from '@logger'
import {
  isFunctionCallingModel,
  isNotSupportTemperatureAndTopP,
  isOpenAIModel,
  isSupportFlexServiceTierModel
} from '@renderer/config/models'
import { REFERENCE_PROMPT } from '@renderer/config/prompts'
import { isSupportServiceTierProvider } from '@renderer/config/providers'
import { getLMStudioKeepAliveTime } from '@renderer/hooks/useLMStudio'
import { getAssistantSettings } from '@renderer/services/AssistantService'
import {
  Assistant,
  FileTypes,
  GenerateImageParams,
  GroqServiceTiers,
  isGroqServiceTier,
  isOpenAIServiceTier,
  KnowledgeReference,
  MCPCallToolResponse,
  MCPTool,
  MCPToolResponse,
  MemoryItem,
  Model,
  OpenAIServiceTiers,
  Provider,
  SystemProviderIds,
  ToolCallResponse,
  WebSearchProviderResponse,
  WebSearchResponse
} from '@renderer/types'
import { Message } from '@renderer/types/newMessage'
import {
  RequestOptions,
  SdkInstance,
  SdkMessageParam,
  SdkModel,
  SdkParams,
  SdkRawChunk,
  SdkRawOutput,
  SdkTool,
  SdkToolCall
} from '@renderer/types/sdk'
import { isJSON, parseJSON } from '@renderer/utils'
import { addAbortController, removeAbortController } from '@renderer/utils/abortController'
import { findFileBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { defaultTimeout } from '@shared/config/constant'
import { isEmpty } from 'lodash'

import { CompletionsContext } from '../middleware/types'
import { ApiClient, RequestTransformer, ResponseChunkTransformer } from './types'

const logger = loggerService.withContext('BaseApiClient')

/**
 * Abstract base class for API clients.
 * Provides common functionality and structure for specific client implementations.
 */
export abstract class BaseApiClient<
  TSdkInstance extends SdkInstance = SdkInstance,
  TSdkParams extends SdkParams = SdkParams,
  TRawOutput extends SdkRawOutput = SdkRawOutput,
  TRawChunk extends SdkRawChunk = SdkRawChunk,
  TMessageParam extends SdkMessageParam = SdkMessageParam,
  TToolCall extends SdkToolCall = SdkToolCall,
  TSdkSpecificTool extends SdkTool = SdkTool
> implements ApiClient<TSdkInstance, TSdkParams, TRawOutput, TRawChunk, TMessageParam, TToolCall, TSdkSpecificTool>
{
  public provider: Provider
  protected host: string
  protected apiKey: string
  protected sdkInstance?: TSdkInstance

  constructor(provider: Provider) {
    this.provider = provider
    this.host = this.getBaseURL()
    this.apiKey = this.getApiKey()
  }

  /**
   * 获取客户端的兼容性类型
   * 用于判断客户端是否支持特定功能，避免instanceof检查的类型收窄问题
   * 对于装饰器模式的客户端（如AihubmixAPIClient），应该返回其内部实际使用的客户端类型
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public getClientCompatibilityType(_model?: Model): string[] {
    // 默认返回类的名称
    return [this.constructor.name]
  }

  // // 核心的completions方法 - 在中间件架构中，这通常只是一个占位符
  // abstract completions(params: CompletionsParams, internal?: ProcessingState): Promise<CompletionsResult>

  /**
   * 核心API Endpoint
   **/

  abstract createCompletions(payload: TSdkParams, options?: RequestOptions): Promise<TRawOutput>

  abstract generateImage(generateImageParams: GenerateImageParams): Promise<string[]>

  abstract getEmbeddingDimensions(model?: Model): Promise<number>

  abstract listModels(): Promise<SdkModel[]>

  abstract getSdkInstance(): Promise<TSdkInstance> | TSdkInstance

  /**
   * 中间件
   **/

  // 在 CoreRequestToSdkParamsMiddleware中使用
  abstract getRequestTransformer(): RequestTransformer<TSdkParams, TMessageParam>
  // 在RawSdkChunkToGenericChunkMiddleware中使用
  abstract getResponseChunkTransformer(ctx: CompletionsContext): ResponseChunkTransformer<TRawChunk>

  /**
   * 工具转换
   **/

  // Optional tool conversion methods - implement if needed by the specific provider
  abstract convertMcpToolsToSdkTools(mcpTools: MCPTool[]): TSdkSpecificTool[]

  abstract convertSdkToolCallToMcp(toolCall: TToolCall, mcpTools: MCPTool[]): MCPTool | undefined

  abstract convertSdkToolCallToMcpToolResponse(toolCall: TToolCall, mcpTool: MCPTool): ToolCallResponse

  abstract buildSdkMessages(
    currentReqMessages: TMessageParam[],
    output: TRawOutput | string | undefined,
    toolResults: TMessageParam[],
    toolCalls?: TToolCall[]
  ): TMessageParam[]

  abstract estimateMessageTokens(message: TMessageParam): number

  abstract convertMcpToolResponseToSdkMessageParam(
    mcpToolResponse: MCPToolResponse,
    resp: MCPCallToolResponse,
    model: Model
  ): TMessageParam | undefined

  /**
   * 从SDK载荷中提取消息数组（用于中间件中的类型安全访问）
   * 不同的提供商可能使用不同的字段名（如messages、history等）
   */
  abstract extractMessagesFromSdkPayload(sdkPayload: TSdkParams): TMessageParam[]

  /**
   * 通用函数
   **/

  public getBaseURL(): string {
    return this.provider.apiHost
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

  public getTemperature(assistant: Assistant, model: Model): number | undefined {
    if (isNotSupportTemperatureAndTopP(model)) {
      return undefined
    }
    const assistantSettings = getAssistantSettings(assistant)
    return assistantSettings?.enableTemperature ? assistantSettings?.temperature : undefined
  }

  public getTopP(assistant: Assistant, model: Model): number | undefined {
    if (isNotSupportTemperatureAndTopP(model)) {
      return undefined
    }
    const assistantSettings = getAssistantSettings(assistant)
    return assistantSettings?.enableTopP ? assistantSettings?.topP : undefined
  }

  // NOTE: 这个也许可以迁移到OpenAIBaseClient
  protected getServiceTier(model: Model) {
    const serviceTierSetting = this.provider.serviceTier

    if (!isSupportServiceTierProvider(this.provider) || !isOpenAIModel(model) || !serviceTierSetting) {
      return undefined
    }

    // 处理不同供应商需要 fallback 到默认值的情况
    if (this.provider.id === SystemProviderIds.groq) {
      if (
        !isGroqServiceTier(serviceTierSetting) ||
        (serviceTierSetting === GroqServiceTiers.flex && !isSupportFlexServiceTierModel(model))
      ) {
        return undefined
      }
    } else {
      // 其他 OpenAI 供应商，假设他们的服务层级设置和 OpenAI 完全相同
      if (
        !isOpenAIServiceTier(serviceTierSetting) ||
        (serviceTierSetting === OpenAIServiceTiers.flex && !isSupportFlexServiceTierModel(model))
      ) {
        return undefined
      }
    }

    return serviceTierSetting
  }

  protected getTimeout(model: Model) {
    if (isSupportFlexServiceTierModel(model)) {
      return 15 * 1000 * 60
    }
    return defaultTimeout
  }

  public async getMessageContent(message: Message): Promise<string> {
    const content = getMainTextContent(message)

    if (isEmpty(content)) {
      return ''
    }

    const webSearchReferences = await this.getWebSearchReferencesFromCache(message)
    const knowledgeReferences = await this.getKnowledgeBaseReferencesFromCache(message)
    const memoryReferences = this.getMemoryReferencesFromCache(message)

    // 添加偏移量以避免ID冲突
    const reindexedKnowledgeReferences = knowledgeReferences.map((ref) => ({
      ...ref,
      id: ref.id + webSearchReferences.length // 为知识库引用的ID添加网络搜索引用的数量作为偏移量
    }))

    const allReferences = [...webSearchReferences, ...reindexedKnowledgeReferences, ...memoryReferences]

    logger.debug(`Found ${allReferences.length} references for ID: ${message.id}`, allReferences)

    if (!isEmpty(allReferences)) {
      const referenceContent = `\`\`\`json\n${JSON.stringify(allReferences, null, 2)}\n\`\`\``
      return REFERENCE_PROMPT.replace('{question}', content).replace('{references}', referenceContent)
    }

    return content
  }

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
          const fileContent = (await window.api.file.read(file.id + file.ext, true)).trim()
          const fileNameRow = 'file: ' + file.origin_name + '\n\n'
          text = text + fileNameRow + fileContent + divider
        }

        return text
      }
    }

    return ''
  }

  private getMemoryReferencesFromCache(message: Message) {
    const memories = window.keyv.get(`memory-search-${message.id}`) as MemoryItem[] | undefined
    if (memories) {
      const memoryReferences: KnowledgeReference[] = memories.map((mem, index) => ({
        id: index + 1,
        content: `${mem.memory} -- Created at: ${mem.createdAt}`,
        sourceUrl: '',
        type: 'memory'
      }))
      return memoryReferences
    }
    return []
  }

  private async getWebSearchReferencesFromCache(message: Message) {
    const content = getMainTextContent(message)
    if (isEmpty(content)) {
      return []
    }
    const webSearch: WebSearchResponse = window.keyv.get(`web-search-${message.id}`)

    if (webSearch) {
      window.keyv.remove(`web-search-${message.id}`)
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
      window.keyv.remove(`knowledge-search-${message.id}`)
      logger.debug(`Found ${knowledgeReferences.length} knowledge base references in cache for ID: ${message.id}`)
      return knowledgeReferences
    }
    logger.debug(`No knowledge base references found in cache for ID: ${message.id}`)
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

  public createAbortController(messageId?: string, isAddEventListener?: boolean) {
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

  // Setup tools configuration based on provided parameters
  public setupToolsConfig(params: { mcpTools?: MCPTool[]; model: Model; enableToolUse?: boolean }): {
    tools: TSdkSpecificTool[]
  } {
    const { mcpTools, model, enableToolUse } = params
    let tools: TSdkSpecificTool[] = []

    // If there are no tools, return an empty array
    if (!mcpTools?.length) {
      return { tools }
    }

    // If the model supports function calling and tool usage is enabled
    if (isFunctionCallingModel(model) && enableToolUse) {
      tools = this.convertMcpToolsToSdkTools(mcpTools)
    }

    return { tools }
  }
}
