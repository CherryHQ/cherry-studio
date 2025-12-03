import type { AnthropicProviderOptions } from '@ai-sdk/anthropic'
import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
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
import { AiSdkToAnthropicSSE, formatSSEDone, formatSSEEvent } from '@main/apiServer/adapters'
import { generateSignature as cherryaiGenerateSignature } from '@main/integration/cherryai'
import anthropicService from '@main/services/AnthropicService'
import copilotService from '@main/services/CopilotService'
import { reduxService } from '@main/services/ReduxService'
import type { OpenRouterProviderOptions } from '@openrouter/ai-sdk-provider'
import { isGemini3ModelId } from '@shared/middleware'
import {
  type AiSdkConfig,
  type AiSdkConfigContext,
  formatProviderApiHost,
  initializeSharedProviders,
  isAnthropicProvider,
  isGeminiProvider,
  isOpenAIProvider,
  type ProviderFormatContext,
  providerToAiSdkConfig as sharedProviderToAiSdkConfig,
  resolveActualProvider,
  SystemProviderIds
} from '@shared/provider'
import { COPILOT_DEFAULT_HEADERS } from '@shared/provider/constant'
import { defaultAppHeaders } from '@shared/utils'
import type { Provider } from '@types'
import type { ImagePart, JSONValue, ModelMessage, Provider as AiSdkProvider, TextPart, Tool as AiSdkTool } from 'ai'
import { simulateStreamingMiddleware, stepCountIs, tool, wrapLanguageModel, zodSchema } from 'ai'
import { net } from 'electron'
import type { Response } from 'express'
import * as z from 'zod'

import { googleReasoningCache, openRouterReasoningCache } from '../../services/CacheService'

const logger = loggerService.withContext('UnifiedMessagesService')

const MAGIC_STRING = 'skip_thought_signature_validator'

function sanitizeJson(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value))
}

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

// Type alias for JSON Schema (compatible with recursive calls)
type JsonSchemaLike = AnthropicTool.InputSchema | Record<string, unknown>

/**
 * Convert JSON Schema to Zod schema
 * This avoids non-standard fields like input_examples that Anthropic doesn't support
 */
function jsonSchemaToZod(schema: JsonSchemaLike): z.ZodTypeAny {
  const s = schema as Record<string, unknown>
  const schemaType = s.type as string | string[] | undefined
  const enumValues = s.enum as unknown[] | undefined
  const description = s.description as string | undefined

  // Handle enum first
  if (enumValues && Array.isArray(enumValues) && enumValues.length > 0) {
    if (enumValues.every((v) => typeof v === 'string')) {
      const zodEnum = z.enum(enumValues as [string, ...string[]])
      return description ? zodEnum.describe(description) : zodEnum
    }
    // For non-string enums, use union of literals
    const literals = enumValues.map((v) => z.literal(v as string | number | boolean))
    if (literals.length === 1) {
      return description ? literals[0].describe(description) : literals[0]
    }
    const zodUnion = z.union(literals as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
    return description ? zodUnion.describe(description) : zodUnion
  }

  // Handle union types (type: ["string", "null"])
  if (Array.isArray(schemaType)) {
    const schemas = schemaType.map((t) => jsonSchemaToZod({ ...s, type: t, enum: undefined }))
    if (schemas.length === 1) {
      return schemas[0]
    }
    return z.union(schemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
  }

  // Handle by type
  switch (schemaType) {
    case 'string': {
      let zodString = z.string()
      if (typeof s.minLength === 'number') zodString = zodString.min(s.minLength)
      if (typeof s.maxLength === 'number') zodString = zodString.max(s.maxLength)
      if (typeof s.pattern === 'string') zodString = zodString.regex(new RegExp(s.pattern))
      return description ? zodString.describe(description) : zodString
    }

    case 'number':
    case 'integer': {
      let zodNumber = schemaType === 'integer' ? z.number().int() : z.number()
      if (typeof s.minimum === 'number') zodNumber = zodNumber.min(s.minimum)
      if (typeof s.maximum === 'number') zodNumber = zodNumber.max(s.maximum)
      return description ? zodNumber.describe(description) : zodNumber
    }

    case 'boolean': {
      const zodBoolean = z.boolean()
      return description ? zodBoolean.describe(description) : zodBoolean
    }

    case 'null':
      return z.null()

    case 'array': {
      const items = s.items as Record<string, unknown> | undefined
      let zodArray = items ? z.array(jsonSchemaToZod(items)) : z.array(z.unknown())
      if (typeof s.minItems === 'number') zodArray = zodArray.min(s.minItems)
      if (typeof s.maxItems === 'number') zodArray = zodArray.max(s.maxItems)
      return description ? zodArray.describe(description) : zodArray
    }

    case 'object': {
      const properties = s.properties as Record<string, Record<string, unknown>> | undefined
      const required = (s.required as string[]) || []

      // Always use z.object() to ensure "properties" field is present in output schema
      // OpenAI requires explicit properties field even for empty objects
      const shape: Record<string, z.ZodTypeAny> = {}
      if (properties) {
        for (const [key, propSchema] of Object.entries(properties)) {
          const zodProp = jsonSchemaToZod(propSchema)
          shape[key] = required.includes(key) ? zodProp : zodProp.optional()
        }
      }

      const zodObject = z.object(shape)
      return description ? zodObject.describe(description) : zodObject
    }

    default:
      // Unknown type, use z.unknown()
      return z.unknown()
  }
}

function convertAnthropicToolsToAiSdk(tools: MessageCreateParams['tools']): Record<string, AiSdkTool> | undefined {
  if (!tools || tools.length === 0) return undefined

  const aiSdkTools: Record<string, AiSdkTool> = {}
  for (const anthropicTool of tools) {
    if (anthropicTool.type === 'bash_20250124') continue
    const toolDef = anthropicTool as AnthropicTool
    const rawSchema = toolDef.input_schema
    const schema = jsonSchemaToZod(rawSchema)

    // Use tool() with inputSchema (AI SDK v5 API)
    const aiTool = tool({
      description: toolDef.description || '',
      inputSchema: zodSchema(schema)
    })

    aiSdkTools[toolDef.name] = aiTool
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
          const options: ProviderOptions = {}
          logger.debug('Processing tool call block', { block, msgRole: msg.role, model: params.model })
          if (isGemini3ModelId(params.model)) {
            if (googleReasoningCache.get(`google-${block.name}`)) {
              options.google = {
                thoughtSignature: MAGIC_STRING
              }
            }
          }
          if (openRouterReasoningCache.get(`openrouter-${block.id}`)) {
              options.openrouter = {
                reasoning_details: (sanitizeJson(openRouterReasoningCache.get(`openrouter-${block.id}`)) as JSONValue[]) || []
              }
          }
          toolCallParts.push({
            type: 'tool-call',
            toolName: block.name,
            toolCallId: block.id,
            input: block.input,
            providerOptions: options
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
          if (openRouterReasoningCache.get('openrouter')) {
            providerOptions = {
              openrouter: {
                reasoning_details: (sanitizeJson(openRouterReasoningCache.get('openrouter')) as JSONValue[]) || []
              }
            }
          } else if (isGemini3ModelId(params.model)) {
            providerOptions = {
              google: {
                thoughtSignature: MAGIC_STRING
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

  return provider
}

/**
 * Prepare special provider configuration for providers that need dynamic tokens
 * Similar to renderer's prepareSpecialProviderConfig
 */
async function prepareSpecialProviderConfig(provider: Provider, config: AiSdkConfig): Promise<AiSdkConfig> {
  switch (provider.id) {
    case 'copilot': {
      const storedHeaders =
        ((await reduxService.select('state.copilot.defaultHeaders')) as Record<string, string> | null) ?? {}
      const headers: Record<string, string> = {
        ...COPILOT_DEFAULT_HEADERS,
        ...storedHeaders
      }

      try {
        const { token } = await copilotService.getToken(null as any, headers)
        config.options.apiKey = token
        const existingHeaders = (config.options.headers as Record<string, string> | undefined) ?? {}
        config.options.headers = {
          ...headers,
          ...existingHeaders
        }
      } catch (error) {
        logger.error('Failed to get Copilot token', error as Error)
        throw new Error('Failed to get Copilot token. Please re-authorize Copilot.')
      }
      break
    }
    case 'anthropic': {
      if (provider.authType === 'oauth') {
        try {
          const oauthToken = await anthropicService.getValidAccessToken()
          if (!oauthToken) {
            throw new Error('Anthropic OAuth token not available. Please re-authorize.')
          }
          config.options = {
            ...config.options,
            headers: {
              ...(config.options.headers ? config.options.headers : {}),
              'Content-Type': 'application/json',
              'anthropic-version': '2023-06-01',
              'anthropic-beta': 'oauth-2025-04-20',
              Authorization: `Bearer ${oauthToken}`
            },
            baseURL: 'https://api.anthropic.com/v1',
            apiKey: ''
          }
        } catch (error) {
          logger.error('Failed to get Anthropic OAuth token', error as Error)
          throw new Error('Failed to get Anthropic OAuth token. Please re-authorize.')
        }
      }
      break
    }
    case 'cherryai': {
      // Create a signed fetch wrapper for cherryai
      const baseFetch = net.fetch as typeof globalThis.fetch
      config.options.fetch = async (url: RequestInfo | URL, options?: RequestInit) => {
        if (!options?.body) {
          return baseFetch(url, options)
        }
        const signature = cherryaiGenerateSignature({
          method: 'POST',
          path: '/chat/completions',
          query: '',
          body: JSON.parse(options.body as string)
        })
        return baseFetch(url, {
          ...options,
          headers: {
            ...(options.headers as Record<string, string>),
            ...signature
          }
        })
      }
      break
    }
  }
  return config
}

function mapAnthropicThinkToAISdkProviderOptions(
  provider: Provider,
  config: MessageCreateParams['thinking']
): ProviderOptions | undefined {
  if (!config) return undefined
  if (isAnthropicProvider(provider)) {
    return {
      anthropic: {
        ...mapToAnthropicProviderOptions(config)
      }
    }
  }
  if (isGeminiProvider(provider)) {
    return {
      google: {
        ...mapToGeminiProviderOptions(config)
      }
    }
  }
  if (isOpenAIProvider(provider)) {
    return {
      openai: {
        ...mapToOpenAIProviderOptions(config)
      }
    }
  }
  if (provider.id === SystemProviderIds.openrouter) {
    return {
      openrouter: {
        ...mapToOpenRouterProviderOptions(config)
      }
    }
  }
  return undefined
}

function mapToAnthropicProviderOptions(config: NonNullable<MessageCreateParams['thinking']>): AnthropicProviderOptions {
  return {
    thinking: {
      type: config.type,
      budgetTokens: config.type === 'enabled' ? config.budget_tokens : undefined
    }
  }
}

function mapToGeminiProviderOptions(
  config: NonNullable<MessageCreateParams['thinking']>
): GoogleGenerativeAIProviderOptions {
  return {
    thinkingConfig: {
      thinkingBudget: config.type === 'enabled' ? config.budget_tokens : -1,
      includeThoughts: config.type === 'enabled'
    }
  }
}

function mapToOpenAIProviderOptions(
  config: NonNullable<MessageCreateParams['thinking']>
): OpenAIResponsesProviderOptions {
  return {
    reasoningEffort: config.type === 'enabled' ? 'high' : 'none'
  }
}

function mapToOpenRouterProviderOptions(
  config: NonNullable<MessageCreateParams['thinking']>
): OpenRouterProviderOptions {
  return {
    reasoning: {
      enabled: config.type === 'enabled',
      effort: 'high'
    }
  }
}

/**
 * Core stream execution function - single source of truth for AI SDK calls
 */
async function executeStream(config: ExecuteStreamConfig): Promise<AiSdkToAnthropicSSE> {
  const { provider, modelId, params, middlewares = [], plugins = [], onEvent } = config

  // Convert provider config to AI SDK config
  let sdkConfig = providerToAiSdkConfig(provider, modelId)

  // Prepare special provider config (Copilot, Anthropic OAuth, etc.)
  sdkConfig = await prepareSpecialProviderConfig(provider, sdkConfig)

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

  const result = await executor.streamText({
    model,
    messages: coreMessages,
    // FIXME: Claude Code传入的maxToken会超出有些模型限制，需做特殊处理，可能在v2好修复一点，现在维护的成本有点高
    // 已知: 豆包
    maxOutputTokens: params.max_tokens,
    temperature: params.temperature,
    topP: params.top_p,
    topK: params.top_k,
    stopSequences: params.stop_sequences,
    stopWhen: stepCountIs(100),
    headers: defaultAppHeaders(),
    tools,
    providerOptions: mapAnthropicThinkToAISdkProviderOptions(provider, params.thinking)
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
        logger.silly('Streaming event', { eventType: event.type })
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
