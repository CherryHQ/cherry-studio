import type { LanguageModelV2Middleware, LanguageModelV2ToolResultOutput } from '@ai-sdk/provider'
import type { ProviderOptions, ReasoningPart, ToolCallPart, ToolResultPart } from '@ai-sdk/provider-utils'
import type {
  ImageBlockParam,
  MessageCreateParams,
  TextBlockParam,
  Tool as AnthropicTool
} from '@anthropic-ai/sdk/resources/messages'
import { type AiPlugin, createExecutor } from '@cherrystudio/ai-core'
import { createProvider as createProviderCore } from '@cherrystudio/ai-core/provider'
import { loggerService } from '@logger'
import { reduxService } from '@main/services/ReduxService'
import { AiSdkToAnthropicSSE, formatSSEDone, formatSSEEvent } from '@shared/adapters'
import { isGemini3ModelId } from '@shared/middleware'
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
import type { ImagePart, ModelMessage, Provider as AiSdkProvider, TextPart, Tool } from 'ai'
import { jsonSchema, simulateStreamingMiddleware, stepCountIs, tool, wrapLanguageModel } from 'ai'
import { net } from 'electron'
import type { Response } from 'express'

const logger = loggerService.withContext('UnifiedMessagesService')

const MAGIC_STRING = 'skip_thought_signature_validator'

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

  // Build a map of tool_use_id -> toolName from all messages first
  // This is needed because tool_result references tool_use from previous assistant messages
  const toolCallIdToName = new Map<string, string>()
  for (const msg of params.messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          toolCallIdToName.set(block.id, block.name)
        }
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
          // Look up toolName from the pre-built map (covers cross-message references)
          const toolName = toolCallIdToName.get(block.tool_use_id) || 'unknown'
          toolResultParts.push({
            type: 'tool-result',
            toolCallId: block.tool_use_id,
            toolName,
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
          let providerOptions: ProviderOptions | undefined = undefined
          if (isGemini3ModelId(params.model)) {
            providerOptions = {
              google: {
                thoughtSignature: MAGIC_STRING
              },
              openrouter: {
                reasoning_details: []
              }
            }
          }
          messages.push({ role: 'assistant', content: assistantContent, providerOptions })
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
 * Create AI SDK provider instance from config
 * Similar to renderer's createAiSdkProvider
 */
async function createAiSdkProvider(config: AiSdkConfig): Promise<AiSdkProvider> {
  let providerId = config.providerId

  // Handle special provider modes (same as renderer)
  if (providerId === 'openai' && config.options?.mode === 'chat') {
    providerId = 'openai-chat'
  } else if (providerId === 'azure' && config.options?.mode === 'responses') {
    providerId = 'azure-responses'
  } else if (providerId === 'cherryin' && config.options?.mode === 'chat') {
    providerId = 'cherryin-chat'
  }

  const provider = await createProviderCore(providerId, config.options)

  logger.debug('AI SDK provider created', {
    providerId,
    hasOptions: !!config.options
  })

  return provider
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
    hasOptions: !!sdkConfig.options,
    message: params.messages
  })

  // Create provider instance and get language model
  const aiSdkProvider = await createAiSdkProvider(sdkConfig)
  const baseModel = aiSdkProvider.languageModel(modelId)

  // Apply middlewares if present
  const model =
    middlewares.length > 0 && typeof baseModel === 'object'
      ? (wrapLanguageModel({ model: baseModel, middleware: middlewares }) as typeof baseModel)
      : baseModel

  // Create executor with plugins
  const executor = createExecutor(sdkConfig.providerId, sdkConfig.options, plugins)

  // Convert messages and tools
  const coreMessages = convertAnthropicToAiMessages(params)
  const tools = convertAnthropicToolsToAiSdk(params.tools)

  // Create the adapter
  const adapter = new AiSdkToAnthropicSSE({
    model: `${provider.id}:${modelId}`,
    onEvent: onEvent || (() => {})
  })

  // Execute stream - pass model object instead of string
  const result = await executor.streamText({
    model, // Now passing LanguageModel object, not string
    messages: coreMessages,
    maxOutputTokens: params.max_tokens,
    temperature: params.temperature,
    topP: params.top_p,
    stopSequences: params.stop_sequences,
    stopWhen: stepCountIs(100),
    headers: defaultAppHeaders(),
    tools,
    providerOptions: {}
  })

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
