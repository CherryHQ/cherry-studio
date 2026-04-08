import { createAgent, embedMany as aiCoreEmbedMany, generateImage as aiCoreGenerateImage } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { reduxService } from '@main/services/ReduxService'
import type { Assistant, Model, Provider } from '@types'
import type {
  ChatTransport,
  EmbeddingModelUsage,
  LanguageModelUsage,
  ModelMessage,
  ToolSet,
  UIMessage,
  UIMessageChunk
} from 'ai'

import { type AgentOptions, runAgentLoop } from './agentLoop'
import { buildPlugins } from './plugins/PluginBuilder'
import { adaptProvider, providerToAiSdkConfig } from './provider/providerConfig'
import { listModels as listModelsFromProvider } from './services/listModels'
import { registerMcpTools } from './tools/mcpTools'
import type { ToolRegistry } from './tools/ToolRegistry'
import type { AppProviderSettingsMap } from './types'

const logger = loggerService.withContext('AiCompletionService')

type ChatTrigger = Parameters<ChatTransport<UIMessage>['sendMessages']>[0]['trigger']

// ── Request types ──

/** Base fields shared by all AI requests. */
export interface AiBaseRequest {
  assistantId?: string
  providerId?: string
  modelId?: string
  mcpToolIds?: string[]
}

/** Streaming chat request. */
export interface AiStreamRequest extends AiBaseRequest {
  requestId: string
  chatId: string
  trigger: ChatTrigger
  messageId?: string
  messages: UIMessage[]
  knowledgeBaseIds?: string[]
}

/** Non-streaming text generation request. */
export interface AiGenerateRequest extends AiBaseRequest {
  system?: string
  prompt?: string
  messages?: ModelMessage[]
}

/** Result of non-streaming text generation. */
export interface AiGenerateResult {
  text: string
  usage?: LanguageModelUsage
}

/** Image generation request. */
export interface AiImageRequest extends AiBaseRequest {
  prompt: string
  /** Input images for editing (base64 data URLs or URLs). If provided, uses edit mode. */
  inputImages?: string[]
  /** Mask for inpainting (only with inputImages). */
  mask?: string
  n?: number
  size?: string
}

/** Image generation result. */
export interface AiImageResult {
  images: string[]
}

/** Embedding request. */
export interface AiEmbedRequest extends AiBaseRequest {
  values: string[]
}

/** Embedding result. */
export interface AiEmbedResult {
  embeddings: number[][]
  usage?: EmbeddingModelUsage
}

// ── Service ──

export class AiCompletionService {
  private activeRequests = new Map<string, AbortController>()

  constructor(private toolRegistry: ToolRegistry) {}

  // ── Streaming chat (agent.stream) ──

  streamText(request: AiStreamRequest, signal: AbortSignal): ReadableStream<UIMessageChunk> {
    logger.info('streamText started', { requestId: request.requestId, chatId: request.chatId })

    const { readable, writable } = new TransformStream<UIMessageChunk>()
    const writer = writable.getWriter()

    this.resolveAndStream(request, signal, writer).catch(async (error) => {
      logger.error('streamText failed', { requestId: request.requestId, error })
      await writer.abort(error).catch(() => {})
    })

    return readable
  }

  private async resolveAndStream(
    request: AiStreamRequest,
    signal: AbortSignal,
    writer: WritableStreamDefaultWriter<UIMessageChunk>
  ): Promise<void> {
    const { sdkConfig, tools, plugins, system, options, model } = await this.buildAgentParams(request)

    const stream = runAgentLoop(
      {
        providerId: sdkConfig.providerId,
        providerSettings: sdkConfig.providerSettings,
        modelId: sdkConfig.modelId,
        plugins,
        tools,
        system,
        options,
        hooks: {
          onFinish: (result) => this.trackUsage(model, result.totalUsage)
        }
      },
      request.messages,
      signal
    )

    const reader = stream.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done || signal.aborted) break
        await writer.write(value)
      }
      await writer.close()
    } finally {
      reader.releaseLock()
    }
  }

  // ── Non-streaming text generation (agent.generate) ──

  async generateText(request: AiGenerateRequest): Promise<AiGenerateResult> {
    logger.info('generateText started', { assistantId: request.assistantId })

    const { sdkConfig, tools, plugins, system, options, model } = await this.buildAgentParams(request)

    const agent = await createAgent<AppProviderSettingsMap, typeof sdkConfig.providerId, ToolSet>({
      providerId: sdkConfig.providerId,
      providerSettings: sdkConfig.providerSettings,
      modelId: sdkConfig.modelId,
      plugins,
      agentSettings: {
        tools,
        instructions: request.system ?? system,
        ...options
      }
    })

    // prompt and messages are mutually exclusive in AI SDK
    const result = request.prompt
      ? await agent.generate({ prompt: request.prompt })
      : await agent.generate({ messages: request.messages ?? [] })

    this.trackUsage(model, result.usage)
    return { text: result.text, usage: result.usage }
  }

  // ── Image generation ──

  async generateImage(request: AiImageRequest): Promise<AiImageResult> {
    logger.info('generateImage started', { assistantId: request.assistantId })

    const { sdkConfig } = await this.buildAgentParams(request)

    const promptParam = request.inputImages
      ? { text: request.prompt, images: request.inputImages, ...(request.mask && { mask: request.mask }) }
      : request.prompt

    const result = await aiCoreGenerateImage<AppProviderSettingsMap>(sdkConfig.providerId, sdkConfig.providerSettings, {
      model: sdkConfig.modelId,
      prompt: promptParam,
      n: request.n ?? 1,
      size: (request.size ?? '1024x1024') as `${number}x${number}`
    })

    const images: string[] = []
    for (const image of result.images ?? []) {
      if (image.base64) {
        images.push(`data:${image.mediaType || 'image/png'};base64,${image.base64}`)
      }
    }
    return { images }
  }

  // ── Embedding ──

  async embedMany(request: AiEmbedRequest): Promise<AiEmbedResult> {
    logger.info('embedMany started', { assistantId: request.assistantId, count: request.values.length })

    const { sdkConfig, model } = await this.buildAgentParams(request)

    const result = await aiCoreEmbedMany<AppProviderSettingsMap>(sdkConfig.providerId, sdkConfig.providerSettings, {
      model: sdkConfig.modelId,
      values: request.values
    })

    this.trackUsage(model, { inputTokens: result.usage?.tokens ?? 0, outputTokens: 0 })
    return { embeddings: result.embeddings, usage: result.usage }
  }

  async getEmbeddingDimensions(request: AiBaseRequest): Promise<number> {
    const { embeddings } = await this.embedMany({ ...request, values: ['test'] })
    return embeddings[0].length
  }

  // ── Model listing ──

  async listModels(request: AiBaseRequest): Promise<Model[]> {
    const { provider } = await this.resolveFromRedux(request)
    return listModelsFromProvider(provider)
  }

  // ── API validation ──

  async checkModel(request: AiBaseRequest & { timeout?: number }): Promise<{ latency: number }> {
    const start = performance.now()
    const timeout = request.timeout ?? 15000
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Check model timeout')), timeout)
    )

    await Promise.race([this.generateText({ ...request, system: 'test', prompt: 'hi' }), timeoutPromise])

    return { latency: performance.now() - start }
  }

  // ── Shared agent parameter resolution ──

  private async buildAgentParams(request: AiBaseRequest) {
    const { provider, model, assistant } = await this.resolveFromRedux(request)

    const adapted = adaptProvider({ provider })
    const sdkConfig = {
      ...(await providerToAiSdkConfig(adapted, model)),
      modelId: model.id
    }

    // Register MCP tools on-demand, then resolve
    if (request.mcpToolIds?.length) {
      await registerMcpTools(this.toolRegistry, request.mcpToolIds)
    }
    const tools = this.toolRegistry.resolve(request.mcpToolIds)

    const plugins = buildPlugins()
    const system = assistant?.prompt || undefined

    // Extract model parameters from assistant settings
    const settings = assistant?.settings
    const options: AgentOptions = {
      ...(settings?.enableTemperature !== false &&
        settings?.temperature != null && { temperature: settings.temperature }),
      ...(settings?.enableTopP !== false && settings?.topP != null && { topP: settings.topP }),
      ...(settings?.enableMaxTokens && settings?.maxTokens != null && { maxOutputTokens: settings.maxTokens })
    }

    return { sdkConfig, tools, plugins, system, options, provider, model, assistant }
  }

  // ── Token usage tracking ──

  private trackUsage(model: Model, usage?: { inputTokens?: number; outputTokens?: number }): void {
    if (!usage || !model.provider || !model.id) return
    const inputTokens = usage.inputTokens ?? 0
    const outputTokens = usage.outputTokens ?? 0
    if (inputTokens === 0 && outputTokens === 0) return

    try {
      const analyticsService = application.get('AnalyticsService')
      analyticsService.trackTokenUsage({
        provider: model.provider,
        model: model.id,
        input_tokens: inputTokens,
        output_tokens: outputTokens
      })
    } catch {
      // AnalyticsService may not be activated (data collection disabled)
    }
  }

  /** Resolve provider + model from Redux. Priority: explicit > assistant.model */
  private async resolveFromRedux(request: AiBaseRequest) {
    const providers = await reduxService.select<Provider[]>('state.llm.providers')

    let assistant: Assistant | undefined
    if (request.assistantId) {
      const assistants = await reduxService.select<Assistant[]>('state.assistants.assistants')
      assistant = assistants.find((a: Assistant) => a.id === request.assistantId)
    }

    const providerId = request.providerId ?? assistant?.model?.provider
    if (!providerId) throw new Error('Cannot resolve providerId: not in request and assistant has no model')

    const provider = providers.find((p: Provider) => p.id === providerId)
    if (!provider) throw new Error(`Provider not found: ${providerId}`)

    const modelId = request.modelId ?? assistant?.model?.id
    if (!modelId) throw new Error('Cannot resolve modelId: not in request and assistant has no model')

    const model = provider.models?.find((m: Model) => m.id === modelId)
    if (!model) throw new Error(`Model not found: ${modelId} in provider ${providerId}`)

    return { provider, model, assistant }
  }

  // ── Request tracking ──

  registerRequest(requestId: string, controller: AbortController): void {
    this.activeRequests.set(requestId, controller)
  }

  removeRequest(requestId: string): void {
    this.activeRequests.delete(requestId)
  }

  abort(requestId: string): void {
    const controller = this.activeRequests.get(requestId)
    if (controller) {
      controller.abort()
      this.activeRequests.delete(requestId)
      logger.info('Request aborted', { requestId })
    }
  }
}
