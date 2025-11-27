import type { LanguageModelV2Middleware, LanguageModelV2ToolResultOutput } from '@ai-sdk/provider'
import type { ReasoningPart, ToolCallPart, ToolResultPart } from '@ai-sdk/provider-utils'
import type {
  ImageBlockParam,
  MessageCreateParams,
  TextBlockParam,
  Tool as AnthropicTool
} from '@anthropic-ai/sdk/resources/messages'
import { type AiPlugin, createExecutor } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { reduxService } from '@main/services/ReduxService'
import { AiSdkToAnthropicSSE, formatSSEDone, formatSSEEvent } from '@shared/adapters'
import {
  type AiSdkConfig,
  type AiSdkConfigContext,
  formatProviderApiHost,
  initializeSharedProviders,
  type ProviderFormatContext,
  providerToAiSdkConfig as sharedProviderToAiSdkConfig,
  resolveActualProvider
} from '@shared/provider'
import { defaultAppHeaders } from '@shared/utils'
import type { Provider } from '@types'
import type { ImagePart, ModelMessage, TextPart, Tool } from 'ai'
import { jsonSchema, simulateStreamingMiddleware, stepCountIs, tool } from 'ai'
import { net } from 'electron'
import type { Response } from 'express'

const logger = loggerService.withContext('UnifiedMessagesService')

initializeSharedProviders({
  warn: (message) => logger.warn(message),
  error: (message, error) => logger.error(message, error)
})

/**
 * Configuration for unified message streaming
 */
export interface UnifiedStreamConfig {
  response: Response
  provider: Provider
  modelId: string
  params: MessageCreateParams
  onError?: (error: unknown) => void
  onComplete?: () => void
  /**
   * Optional AI SDK middlewares to apply
   */
  middlewares?: LanguageModelV2Middleware[]
  /**
   * Optional AI Core plugins to use with the executor
   */
  plugins?: AiPlugin[]
}

/**
 * Configuration for non-streaming message generation
 */
export interface GenerateUnifiedMessageConfig {
  provider: Provider
  modelId: string
  params: MessageCreateParams
  middlewares?: LanguageModelV2Middleware[]
  plugins?: AiPlugin[]
}

// ============================================================================
// Internal Utilities
// ============================================================================

function getMainProcessFormatContext(): ProviderFormatContext {
  const vertexSettings = reduxService.selectSync<{ projectId: string; location: string }>('state.llm.settings.vertexai')
  return {
    vertex: {
      project: vertexSettings?.projectId || 'default-project',
      location: vertexSettings?.location || 'us-central1'
    }
  }
}

const mainProcessSdkContext: AiSdkConfigContext = {
  getRotatedApiKey: (provider) => {
    const keys = provider.apiKey.split(',').map((k) => k.trim())
    return keys[0] || provider.apiKey
  },
  fetch: net.fetch as typeof globalThis.fetch
}

function getActualProvider(provider: Provider, modelId: string): Provider {
  const model = provider.models?.find((m) => m.id === modelId)
  if (!model) return provider
  return resolveActualProvider(provider, model)
}

function providerToAiSdkConfig(provider: Provider, modelId: string): AiSdkConfig {
  const actualProvider = getActualProvider(provider, modelId)
  const formattedProvider = formatProviderApiHost(actualProvider, getMainProcessFormatContext())
  return sharedProviderToAiSdkConfig(formattedProvider, modelId, mainProcessSdkContext)
}

function convertAnthropicToolResultToAiSdk(
  content: string | Array<TextBlockParam | ImageBlockParam>
): LanguageModelV2ToolResultOutput {
  if (typeof content === 'string') {
    return { type: 'text', value: content }
  }
  const values: Array<{ type: 'text'; text: string } | { type: 'media'; data: string; mediaType: string }> = []
  for (const block of content) {
    if (block.type === 'text') {
      values.push({ type: 'text', text: block.text })
    } else if (block.type === 'image') {
      values.push({
        type: 'media',
        data: block.source.type === 'base64' ? block.source.data : block.source.url,
        mediaType: block.source.type === 'base64' ? block.source.media_type : 'image/png'
      })
    }
  }
  return { type: 'content', value: values }
}

function convertAnthropicToolsToAiSdk(tools: MessageCreateParams['tools']): Record<string, Tool> | undefined {
  if (!tools || tools.length === 0) return undefined

  const aiSdkTools: Record<string, Tool> = {}
  for (const anthropicTool of tools) {
    if (anthropicTool.type === 'bash_20250124') continue
    const toolDef = anthropicTool as AnthropicTool
    const parameters = toolDef.input_schema as Parameters<typeof jsonSchema>[0]
    aiSdkTools[toolDef.name] = tool({
      description: toolDef.description || '',
      inputSchema: jsonSchema(parameters),
      execute: async (input: Record<string, unknown>) => input
    })
  }
  return Object.keys(aiSdkTools).length > 0 ? aiSdkTools : undefined
}

function convertAnthropicToAiMessages(params: MessageCreateParams): ModelMessage[] {
  const messages: ModelMessage[] = []

  // System message
  if (params.system) {
    if (typeof params.system === 'string') {
      messages.push({ role: 'system', content: params.system })
    } else if (Array.isArray(params.system)) {
      const systemText = params.system
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
      if (systemText) {
        messages.push({ role: 'system', content: systemText })
      }
    }
  }

  // User/assistant messages
  for (const msg of params.messages) {
    if (typeof msg.content === 'string') {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      })
    } else if (Array.isArray(msg.content)) {
      const textParts: TextPart[] = []
      const imageParts: ImagePart[] = []
      const reasoningParts: ReasoningPart[] = []
      const toolCallParts: ToolCallPart[] = []
      const toolResultParts: ToolResultPart[] = []

      for (const block of msg.content) {
        if (block.type === 'text') {
          textParts.push({ type: 'text', text: block.text })
        } else if (block.type === 'thinking') {
          reasoningParts.push({ type: 'reasoning', text: block.thinking })
        } else if (block.type === 'redacted_thinking') {
          reasoningParts.push({ type: 'reasoning', text: block.data })
        } else if (block.type === 'image') {
          const source = block.source
          if (source.type === 'base64') {
            imageParts.push({ type: 'image', image: `data:${source.media_type};base64,${source.data}` })
          } else if (source.type === 'url') {
            imageParts.push({ type: 'image', image: source.url })
          }
        } else if (block.type === 'tool_use') {
          toolCallParts.push({
            type: 'tool-call',
            toolName: block.name,
            toolCallId: block.id,
            input: block.input
          })
        } else if (block.type === 'tool_result') {
          toolResultParts.push({
            type: 'tool-result',
            toolCallId: block.tool_use_id,
            toolName: toolCallParts.find((t) => t.toolCallId === block.tool_use_id)?.toolName || 'unknown',
            output: block.content ? convertAnthropicToolResultToAiSdk(block.content) : { type: 'text', value: '' }
          })
        }
      }

      if (toolResultParts.length > 0) {
        messages.push({ role: 'tool', content: [...toolResultParts] })
      }

      if (msg.role === 'user') {
        const userContent = [...textParts, ...imageParts]
        if (userContent.length > 0) {
          messages.push({ role: 'user', content: userContent })
        }
      } else {
        const assistantContent = [...reasoningParts, ...textParts, ...toolCallParts]
        if (assistantContent.length > 0) {
          messages.push({ role: 'assistant', content: assistantContent })
        }
      }
    }
  }

  return messages
}

interface ExecuteStreamConfig {
  provider: Provider
  modelId: string
  params: MessageCreateParams
  middlewares?: LanguageModelV2Middleware[]
  plugins?: AiPlugin[]
  onEvent?: (event: Parameters<typeof formatSSEEvent>[0]) => void
}

/**
 * Core stream execution function - single source of truth for AI SDK calls
 */
async function executeStream(config: ExecuteStreamConfig): Promise<AiSdkToAnthropicSSE> {
  const { provider, modelId, params, middlewares = [], plugins = [], onEvent } = config

  // Convert provider config to AI SDK config
  const sdkConfig = providerToAiSdkConfig(provider, modelId)

  logger.debug('Created AI SDK config', {
    providerId: sdkConfig.providerId,
    hasOptions: !!sdkConfig.options
  })

  // Create executor with plugins
  const executor = createExecutor(sdkConfig.providerId, sdkConfig.options, plugins)

  // Convert messages and tools
  const coreMessages = convertAnthropicToAiMessages(params)
  const tools = convertAnthropicToolsToAiSdk(params.tools)

  logger.debug('Converted messages', {
    originalCount: params.messages.length,
    convertedCount: coreMessages.length,
    hasSystem: !!params.system,
    hasTools: !!tools,
    toolCount: tools ? Object.keys(tools).length : 0
  })

  // Create the adapter
  const adapter = new AiSdkToAnthropicSSE({
    model: `${provider.id}:${modelId}`,
    onEvent: onEvent || (() => {})
  })

  // Execute stream
  const result = await executor.streamText(
    {
      model: modelId,
      messages: coreMessages,
      maxOutputTokens: params.max_tokens,
      temperature: params.temperature,
      topP: params.top_p,
      stopSequences: params.stop_sequences,
      stopWhen: stepCountIs(100),
      headers: defaultAppHeaders(),
      tools,
      providerOptions: {}
    },
    { middlewares }
  )

  // Process the stream through the adapter
  await adapter.processStream(result.fullStream)

  return adapter
}

/**
 * Stream a message request using AI SDK executor and convert to Anthropic SSE format
 */
export async function streamUnifiedMessages(config: UnifiedStreamConfig): Promise<void> {
  const { response, provider, modelId, params, onError, onComplete, middlewares = [], plugins = [] } = config

  logger.info('Starting unified message stream', {
    providerId: provider.id,
    providerType: provider.type,
    modelId,
    stream: params.stream,
    middlewareCount: middlewares.length,
    pluginCount: plugins.length
  })

  try {
    response.setHeader('Content-Type', 'text/event-stream')
    response.setHeader('Cache-Control', 'no-cache')
    response.setHeader('Connection', 'keep-alive')
    response.setHeader('X-Accel-Buffering', 'no')

    await executeStream({
      provider,
      modelId,
      params,
      middlewares,
      plugins,
      onEvent: (event) => {
        const sseData = formatSSEEvent(event)
        response.write(sseData)
      }
    })

    // Send done marker
    response.write(formatSSEDone())
    response.end()

    logger.info('Unified message stream completed', { providerId: provider.id, modelId })
    onComplete?.()
  } catch (error) {
    logger.error('Error in unified message stream', error as Error, { providerId: provider.id, modelId })

    if (!response.writableEnded) {
      try {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        response.write(
          `event: error\ndata: ${JSON.stringify({
            type: 'error',
            error: { type: 'api_error', message: errorMessage }
          })}\n\n`
        )
        response.end()
      } catch {
        // Response already ended
      }
    }

    onError?.(error)
    throw error
  }
}

/**
 * Generate a non-streaming message response
 *
 * Uses simulateStreamingMiddleware to reuse the same streaming logic,
 * similar to renderer's ModernAiProvider pattern.
 */
export async function generateUnifiedMessage(
  providerOrConfig: Provider | GenerateUnifiedMessageConfig,
  modelId?: string,
  params?: MessageCreateParams
): Promise<ReturnType<typeof AiSdkToAnthropicSSE.prototype.buildNonStreamingResponse>> {
  // Support both old signature and new config-based signature
  let config: GenerateUnifiedMessageConfig
  if ('provider' in providerOrConfig && 'modelId' in providerOrConfig && 'params' in providerOrConfig) {
    config = providerOrConfig
  } else {
    config = {
      provider: providerOrConfig as Provider,
      modelId: modelId!,
      params: params!
    }
  }

  const { provider, middlewares = [], plugins = [] } = config

  logger.info('Starting unified message generation', {
    providerId: provider.id,
    providerType: provider.type,
    modelId: config.modelId,
    middlewareCount: middlewares.length,
    pluginCount: plugins.length
  })

  try {
    // Add simulateStreamingMiddleware to reuse streaming logic for non-streaming
    const allMiddlewares = [simulateStreamingMiddleware(), ...middlewares]

    const adapter = await executeStream({
      provider,
      modelId: config.modelId,
      params: config.params,
      middlewares: allMiddlewares,
      plugins
    })

    const finalResponse = adapter.buildNonStreamingResponse()

    logger.info('Unified message generation completed', {
      providerId: provider.id,
      modelId: config.modelId
    })

    return finalResponse
  } catch (error) {
    logger.error('Error in unified message generation', error as Error, {
      providerId: provider.id,
      modelId: config.modelId
    })
    throw error
  }
}

export default {
  streamUnifiedMessages,
  generateUnifiedMessage
}
