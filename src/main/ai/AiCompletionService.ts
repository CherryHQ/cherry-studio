import { loggerService } from '@logger'
import { reduxService } from '@main/services/ReduxService'
import type { Assistant, Model, Provider } from '@types'
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

import { runAgentLoop } from './agentLoop'
import { buildPlugins } from './plugins/PluginBuilder'
import { adaptProvider, providerToAiSdkConfig } from './provider/providerConfig'
import type { ToolRegistry } from './tools/ToolRegistry'

const logger = loggerService.withContext('AiCompletionService')

type ChatTrigger = Parameters<ChatTransport<UIMessage>['sendMessages']>[0]['trigger']

/**
 * Request payload for AI streaming.
 *
 * Sent from Renderer (via IPC) or Main (via Channel/Agent push).
 * Contains all context needed to execute an AI completion.
 */
export interface AiStreamRequest {
  /** Unique identifier for this request. Used for IPC chunk routing and abort. */
  requestId: string
  /** Conversation identifier. All requests in the same chat share this ID. Maps to `useChat({ id })`. */
  chatId: string
  /** Action type defined by AI SDK ChatTransport. */
  trigger: ChatTrigger
  /** ID of the message to regenerate (only for `regenerate-message` trigger). */
  messageId?: string
  /** Conversation history in AI SDK UIMessage format. */
  messages: UIMessage[]
  /** Assistant ID — used to resolve provider/model from Redux if providerId/modelId not explicit. */
  assistantId?: string
  /** AI provider identifier (e.g. 'openai', 'anthropic'). Overrides assistant.model.provider if set. */
  providerId?: string
  /** Model identifier (e.g. 'gpt-4o'). Overrides assistant.model.id if set. */
  modelId?: string
  /**
   * Assistant-level settings (temperature, topP, maxTokens, etc.).
   *
   * TODO (Step 2): Replace `Record<string, unknown>` with a concrete type
   * once BuildContext is designed. Source: renderer's AssistantSettings type,
   * which will be extracted to a shared schema during parameterBuilder migration.
   */
  assistantConfig?: Record<string, unknown>
  /**
   * Web search configuration (maxResults, excludeDomains, searchWithTime, etc.).
   *
   * TODO (Step 2): Replace `Record<string, unknown>` with a concrete type.
   * Source: renderer's Redux store (store.websearch).
   * Will be extracted to a shared schema during parameterBuilder migration.
   */
  websearchConfig?: Record<string, unknown>
  /** MCP tool IDs to enable for this request. */
  mcpToolIds?: string[]
  /** Knowledge base IDs for RAG retrieval. */
  knowledgeBaseIds?: string[]
}

/**
 * Unified AI completion service.
 *
 * Manages AI execution lifecycle: stream creation, abort handling, and request tracking.
 *
 * - Step 1 (current): Mock ReadableStream for IPC pipeline validation.
 * - Step 2: Integrate real aiCore (`createExecutor` + `streamText`).
 */
export class AiCompletionService {
  private activeRequests = new Map<string, AbortController>()

  constructor(private toolRegistry: ToolRegistry) {}

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
    // 1. Resolve assistant → model → provider from Redux
    const { provider, model, assistant } = await this.resolveFromRedux(request)

    // 2. Build SDK config (providerId + providerSettings)
    const adapted = adaptProvider({ provider })
    const sdkConfig = await providerToAiSdkConfig(adapted, model)

    // 3. Resolve tools (Phase 1: likely empty)
    const tools = this.toolRegistry.resolve(request.mcpToolIds)

    // 4. Build plugins (Phase 1: empty array)
    const plugins = buildPlugins()

    // 5. System prompt from assistant
    const system = assistant?.prompt || undefined

    // 6. Run agent loop
    const stream = runAgentLoop(
      {
        providerId: sdkConfig.providerId as string,
        providerSettings: sdkConfig.providerSettings as unknown,
        modelId: model.id,
        plugins,
        tools,
        system
      },
      request.messages,
      signal
    )

    // 7. Pipe to writer
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

  /**
   * Resolve provider + model from Redux.
   * Priority: request.providerId/modelId (explicit) > assistant.model (from assistantId)
   */
  private async resolveFromRedux(request: AiStreamRequest) {
    const providers = await reduxService.select<Provider[]>('state.llm.providers')

    // Try to find assistant for model/provider lookup
    let assistant: Assistant | undefined
    if (request.assistantId) {
      const assistants = await reduxService.select<Assistant[]>('state.assistants.assistants')
      assistant = assistants.find((a: Assistant) => a.id === request.assistantId)
    }

    // Resolve providerId: explicit > assistant.model.provider
    const providerId = request.providerId ?? assistant?.model?.provider
    if (!providerId) throw new Error('Cannot resolve providerId: not in request and assistant has no model')

    const provider = providers.find((p: Provider) => p.id === providerId)
    if (!provider) throw new Error(`Provider not found: ${providerId}`)

    // Resolve modelId: explicit > assistant.model.id
    const modelId = request.modelId ?? assistant?.model?.id
    if (!modelId) throw new Error('Cannot resolve modelId: not in request and assistant has no model')

    const model = provider.models?.find((m: Model) => m.id === modelId)
    if (!model) throw new Error(`Model not found: ${modelId} in provider ${providerId}`)

    return { provider, model, assistant }
  }

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
