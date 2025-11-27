import type { LanguageModelV2ToolResultOutput } from '@ai-sdk/provider'
import type { ReasoningPart, ToolCallPart, ToolResultPart } from '@ai-sdk/provider-utils'
import type {
  ImageBlockParam,
  MessageCreateParams,
  TextBlockParam,
  Tool as AnthropicTool
} from '@anthropic-ai/sdk/resources/messages'
import { createProvider as createProviderCore } from '@cherrystudio/ai-core/provider'
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
import type { ImagePart, LanguageModel, ModelMessage, Provider as AiSdkProvider, TextPart, Tool } from 'ai'
import { jsonSchema, stepCountIs, streamText, tool } from 'ai'
import { net } from 'electron'
import type { Response } from 'express'

const logger = loggerService.withContext('UnifiedMessagesService')

initializeSharedProviders({
  warn: (message) => logger.warn(message),
  error: (message, error) => logger.error(message, error)
})

export interface UnifiedStreamConfig {
  response: Response
  provider: Provider
  modelId: string
  params: MessageCreateParams
  onError?: (error: unknown) => void
  onComplete?: () => void
}

/**
 * Main process format context for formatProviderApiHost
 * Unlike renderer, main process doesn't have direct access to store getters, so use reduxService cache
 */
function getMainProcessFormatContext(): ProviderFormatContext {
  const vertexSettings = reduxService.selectSync<{ projectId: string; location: string }>('state.llm.settings.vertexai')
  return {
    vertex: {
      project: vertexSettings?.projectId || 'default-project',
      location: vertexSettings?.location || 'us-central1'
    }
  }
}

/**
 * Main process context for providerToAiSdkConfig
 * Main process doesn't have access to browser APIs like window.keyv
 */
const mainProcessSdkContext: AiSdkConfigContext = {
  // Simple key rotation - just return first key (no persistent rotation in main process)
  getRotatedApiKey: (provider) => {
    const keys = provider.apiKey.split(',').map((k) => k.trim())
    return keys[0] || provider.apiKey
  },
  fetch: net.fetch as typeof globalThis.fetch
}

/**
 * Get actual provider configuration for a model
 *
 * For aggregated providers (new-api, aihubmix, vertexai, azure-openai),
 * this resolves the actual provider type based on the model's characteristics.
 */
function getActualProvider(provider: Provider, modelId: string): Provider {
  // Find the model in provider's models list
  const model = provider.models?.find((m) => m.id === modelId)
  if (!model) {
    // If model not found, return provider as-is
    return provider
  }

  // Resolve actual provider based on model
  return resolveActualProvider(provider, model)
}

/**
 * Convert Cherry Studio Provider to AI SDK config
 * Uses shared implementation with main process context
 */
function providerToAiSdkConfig(provider: Provider, modelId: string): AiSdkConfig {
  // First resolve actual provider for aggregated providers
  const actualProvider = getActualProvider(provider, modelId)

  // Format the provider's apiHost for AI SDK
  const formattedProvider = formatProviderApiHost(actualProvider, getMainProcessFormatContext())

  // Use shared implementation
  return sharedProviderToAiSdkConfig(formattedProvider, modelId, mainProcessSdkContext)
}

/**
 * Create an AI SDK provider from Cherry Studio provider configuration
 */
async function createAiSdkProvider(config: AiSdkConfig): Promise<AiSdkProvider | null> {
  try {
    const provider = await createProviderCore(config.providerId, config.options)
    logger.debug('AI SDK provider created', {
      providerId: config.providerId,
      hasOptions: !!config.options
    })
    return provider
  } catch (error) {
    logger.error('Failed to create AI SDK provider', error as Error, {
      providerId: config.providerId
    })
    throw error
  }
}

/**
 * Create an AI SDK language model from a Cherry Studio provider configuration
 * Uses shared provider utilities for consistent behavior with renderer
 */
async function createLanguageModel(provider: Provider, modelId: string): Promise<LanguageModel> {
  logger.debug('Creating language model', {
    providerId: provider.id,
    providerType: provider.type,
    modelId,
    apiHost: provider.apiHost
  })

  // Convert provider config to AI SDK config
  const config = providerToAiSdkConfig(provider, modelId)

  // Create the AI SDK provider
  const aiSdkProvider = await createAiSdkProvider(config)
  if (!aiSdkProvider) {
    throw new Error(`Failed to create AI SDK provider for ${provider.id}`)
  }

  // Get the language model
  return aiSdkProvider.languageModel(modelId)
}

function convertAnthropicToolResultToAiSdk(
  content: string | Array<TextBlockParam | ImageBlockParam>
): LanguageModelV2ToolResultOutput {
  if (typeof content === 'string') {
    return {
      type: 'text',
      value: content
    }
  } else {
    const values: Array<
      | { type: 'text'; text: string }
      | {
          type: 'media'
          /**
Base-64 encoded media data.
*/
          data: string
          /**
IANA media type.
@see https://www.iana.org/assignments/media-types/media-types.xhtml
*/
          mediaType: string
        }
    > = []
    for (const block of content) {
      if (block.type === 'text') {
        values.push({
          type: 'text',
          text: block.text
        })
      } else if (block.type === 'image') {
        values.push({
          type: 'media',
          data: block.source.type === 'base64' ? block.source.data : block.source.url,
          mediaType: block.source.type === 'base64' ? block.source.media_type : 'image/png'
        })
      }
    }
    return {
      type: 'content',
      value: values
    }
  }
}

/**
 * Convert Anthropic tools format to AI SDK tools format
 */
function convertAnthropicToolsToAiSdk(tools: MessageCreateParams['tools']): Record<string, Tool> | undefined {
  if (!tools || tools.length === 0) {
    return undefined
  }

  const aiSdkTools: Record<string, Tool> = {}

  for (const anthropicTool of tools) {
    // Handle different tool types
    if (anthropicTool.type === 'bash_20250124') {
      // Skip computer use and bash tools - these are Anthropic-specific
      continue
    }

    // Regular tool (type === 'custom' or no type)
    const toolDef = anthropicTool as AnthropicTool
    const parameters = toolDef.input_schema as Parameters<typeof jsonSchema>[0]

    aiSdkTools[toolDef.name] = tool({
      description: toolDef.description || '',
      inputSchema: jsonSchema(parameters),
      execute: async (input: Record<string, unknown>) => {
        return input
      }
    })
  }

  return Object.keys(aiSdkTools).length > 0 ? aiSdkTools : undefined
}

/**
 * Convert Anthropic MessageCreateParams to AI SDK message format
 */
function convertAnthropicToAiMessages(params: MessageCreateParams): ModelMessage[] {
  const messages: ModelMessage[] = []

  // Add system message if present
  if (params.system) {
    if (typeof params.system === 'string') {
      messages.push({
        role: 'system',
        content: params.system
      })
    } else if (Array.isArray(params.system)) {
      // Handle TextBlockParam array
      const systemText = params.system
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
      if (systemText) {
        messages.push({
          role: 'system',
          content: systemText
        })
      }
    }
  }

  // Convert user/assistant messages
  for (const msg of params.messages) {
    if (typeof msg.content === 'string') {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content })
      } else {
        messages.push({ role: 'assistant', content: msg.content })
      }
    } else if (Array.isArray(msg.content)) {
      // Handle content blocks
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
            imageParts.push({
              type: 'image',
              image: `data:${source.media_type};base64,${source.data}`
            })
          } else if (source.type === 'url') {
            imageParts.push({
              type: 'image',
              image: source.url
            })
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
        messages.push({
          role: 'tool',
          content: [...toolResultParts]
        })
      }

      // Build the message based on role
      // Only push user/assistant message if there's actual content (avoid empty messages)
      if (msg.role === 'user') {
        const userContent = [...textParts, ...imageParts]
        if (userContent.length > 0) {
          messages.push({
            role: 'user',
            content: userContent
          })
        }
      } else {
        // Assistant messages contain tool calls, not tool results
        const assistantContent = [...reasoningParts, ...textParts, ...toolCallParts]
        if (assistantContent.length > 0) {
          messages.push({
            role: 'assistant',
            content: assistantContent
          })
        }
      }
    }
  }

  return messages
}

/**
 * Stream a message request using AI SDK and convert to Anthropic SSE format
 */
// TODO: 使用ai-core executor集成中间件和transformstream进来
export async function streamUnifiedMessages(config: UnifiedStreamConfig): Promise<void> {
  const { response, provider, modelId, params, onError, onComplete } = config

  logger.info('Starting unified message stream', {
    providerId: provider.id,
    providerType: provider.type,
    modelId,
    stream: params.stream
  })

  try {
    response.setHeader('Content-Type', 'text/event-stream')
    response.setHeader('Cache-Control', 'no-cache')
    response.setHeader('Connection', 'keep-alive')
    response.setHeader('X-Accel-Buffering', 'no')

    const model = await createLanguageModel(provider, modelId)

    const coreMessages = convertAnthropicToAiMessages(params)

    // Convert tools if present
    const tools = convertAnthropicToolsToAiSdk(params.tools)

    logger.debug('Converted messages', {
      originalCount: params.messages.length,
      convertedCount: coreMessages.length,
      hasSystem: !!params.system,
      hasTools: !!tools,
      toolCount: tools ? Object.keys(tools).length : 0,
      toolNames: tools ? Object.keys(tools).slice(0, 10) : [],
      paramsToolCount: params.tools?.length || 0
    })

    // Debug: Log message structure to understand tool_result handling
    logger.silly('Message structure for debugging', {
      messages: coreMessages.map((m) => ({
        role: m.role,
        contentTypes: Array.isArray(m.content)
          ? m.content.map((c: { type: string }) => c.type)
          : typeof m.content === 'string'
            ? ['string']
            : ['unknown']
      }))
    })

    // Create the adapter
    const adapter = new AiSdkToAnthropicSSE({
      model: `${provider.id}:${modelId}`,
      onEvent: (event) => {
        const sseData = formatSSEEvent(event)
        response.write(sseData)
      }
    })

    // Start streaming
    const result = streamText({
      model,
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

    // Send done marker
    response.write(formatSSEDone())
    response.end()

    logger.info('Unified message stream completed', {
      providerId: provider.id,
      modelId
    })

    onComplete?.()
  } catch (error) {
    logger.error('Error in unified message stream', error as Error, {
      providerId: provider.id,
      modelId
    })

    // Try to send error event if response is still writable
    if (!response.writableEnded) {
      try {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        response.write(
          `event: error\ndata: ${JSON.stringify({
            type: 'error',
            error: {
              type: 'api_error',
              message: errorMessage
            }
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
 */
export async function generateUnifiedMessage(
  provider: Provider,
  modelId: string,
  params: MessageCreateParams
): Promise<ReturnType<typeof AiSdkToAnthropicSSE.prototype.buildNonStreamingResponse>> {
  logger.info('Starting unified message generation', {
    providerId: provider.id,
    providerType: provider.type,
    modelId
  })

  try {
    // Create language model (async - uses @cherrystudio/ai-core)
    const model = await createLanguageModel(provider, modelId)

    // Convert messages and tools
    const coreMessages = convertAnthropicToAiMessages(params)
    const tools = convertAnthropicToolsToAiSdk(params.tools)

    // Create adapter to collect the response
    let finalResponse: ReturnType<typeof AiSdkToAnthropicSSE.prototype.buildNonStreamingResponse> | null = null
    const adapter = new AiSdkToAnthropicSSE({
      model: `${provider.id}:${modelId}`,
      onEvent: () => {
        // We don't need to emit events for non-streaming
      }
    })

    // Generate text
    const result = streamText({
      model,
      messages: coreMessages,
      maxOutputTokens: params.max_tokens,
      temperature: params.temperature,
      topP: params.top_p,
      stopSequences: params.stop_sequences,
      headers: defaultAppHeaders(),
      tools,
      stopWhen: stepCountIs(100)
    })

    // Process the stream to build the response
    await adapter.processStream(result.fullStream)

    // Get the final response
    finalResponse = adapter.buildNonStreamingResponse()

    logger.info('Unified message generation completed', {
      providerId: provider.id,
      modelId
    })

    return finalResponse
  } catch (error) {
    logger.error('Error in unified message generation', error as Error, {
      providerId: provider.id,
      modelId
    })
    throw error
  }
}

export default {
  streamUnifiedMessages,
  generateUnifiedMessage
}
