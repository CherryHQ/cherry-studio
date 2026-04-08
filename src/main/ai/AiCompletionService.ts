import { createAgent } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { reduxService } from '@main/services/ReduxService'
import type { Assistant, Model, Provider } from '@types'
import type { ChatTransport, LanguageModelUsage, ModelMessage, UIMessage, UIMessageChunk } from 'ai'

import { runAgentLoop } from './agentLoop'
import { buildPlugins } from './plugins/PluginBuilder'
import { adaptProvider, providerToAiSdkConfig } from './provider/providerConfig'
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
  assistantConfig?: Record<string, unknown>
  websearchConfig?: Record<string, unknown>
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
    const { sdkConfig, tools, plugins, system } = await this.buildAgentParams(request)

    const stream = runAgentLoop(
      {
        providerId: sdkConfig.providerId,
        providerSettings: sdkConfig.providerSettings,
        modelId: sdkConfig.modelId,
        plugins,
        tools,
        system
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

    const { sdkConfig, tools, plugins, system } = await this.buildAgentParams(request)

    const agent = await createAgent<AppProviderSettingsMap>({
      providerId: sdkConfig.providerId,
      providerSettings: sdkConfig.providerSettings,
      modelId: sdkConfig.modelId,
      plugins,
      agentSettings: {
        tools,
        instructions: request.system ?? system
      }
    })

    // prompt and messages are mutually exclusive in AI SDK
    const result = request.prompt
      ? await agent.generate({ prompt: request.prompt })
      : await agent.generate({ messages: request.messages ?? [] })

    return { text: result.text, usage: result.usage }
  }

  // ── Shared agent parameter resolution ──

  private async buildAgentParams(request: AiBaseRequest) {
    const { provider, model, assistant } = await this.resolveFromRedux(request)

    const adapted = adaptProvider({ provider })
    const sdkConfig = {
      ...(await providerToAiSdkConfig(adapted, model)),
      modelId: model.id
    }

    const tools = this.toolRegistry.resolve(request.mcpToolIds)
    const plugins = buildPlugins()
    const system = assistant?.prompt || undefined

    return { sdkConfig, tools, plugins, system, provider, model, assistant }
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
