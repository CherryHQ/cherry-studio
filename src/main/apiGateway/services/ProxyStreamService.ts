/**
 * Proxy Stream Service
 *
 * Handles proxying AI requests through the unified AI SDK pipeline,
 * converting between different API formats using the adapter system.
 */

import type { LanguageModelV2Middleware } from '@ai-sdk/provider'
import { type AiPlugin, createExecutor } from '@cherrystudio/ai-core'
import { createProvider as createProviderCore } from '@cherrystudio/ai-core/provider'
import { loggerService } from '@logger'
import { generateSignature as cherryaiGenerateSignature } from '@main/integration/cherryai'
import anthropicService from '@main/services/AnthropicService'
import copilotService from '@main/services/CopilotService'
import mcpService from '@main/services/MCPService'
import { reduxService } from '@main/services/ReduxService'
import {
  type AiSdkConfig,
  type AiSdkConfigContext,
  formatProviderApiHost,
  initializeSharedProviders,
  type ProviderFormatContext,
  providerToAiSdkConfig as sharedProviderToAiSdkConfig,
  resolveActualProvider
} from '@shared/aiCore'
import { COPILOT_DEFAULT_HEADERS } from '@shared/aiCore/constant'
import type { MinimalProvider } from '@shared/types'
import { defaultAppHeaders } from '@shared/utils'
import type { Assistant, MCPTool } from '@types'
import type { Provider } from '@types'
import type { Provider as AiSdkProvider } from 'ai'
import { simulateStreamingMiddleware, stepCountIs, wrapLanguageModel } from 'ai'
import { net } from 'electron'
import type { Response } from 'express'

import type { InputFormat, InputParamsMap, IStreamAdapter } from '../adapters'
import { MessageConverterFactory, type OutputFormat, StreamAdapterFactory } from '../adapters'
import { LONG_POLL_TIMEOUT_MS } from '../config/timeouts'
import { createStreamAbortController } from '../utils/createStreamAbortController'
import { googleReasoningCache, openRouterReasoningCache } from './reasoning-cache'

const logger = loggerService.withContext('ProxyStreamService')

initializeSharedProviders({
  warn: (message) => logger.warn(message),
  error: (message, error) => logger.error(message, error)
})

/**
 * Resolve assistant configuration by ID from Redux store
 */
async function resolveAssistantById(assistantId: string): Promise<Assistant | null> {
  const assistants = (await reduxService.select('state.assistants.assistants')) as Assistant[] | null
  return assistants?.find((assistant) => assistant.id === assistantId) ?? null
}

/**
 * Get provider by ID from Redux store
 */
async function getProviderById(providerId: string): Promise<Provider | null> {
  const providers = (await reduxService.select('state.llm.providers')) as Provider[] | null
  return providers?.find((p) => p.id === providerId) ?? null
}

/**
 * Build MCP tools for assistant using Promise.allSettled for concurrent fetching
 */
async function buildAssistantTools(assistant: Assistant): Promise<MCPTool[]> {
  const servers = assistant.mcpServers ?? []
  if (servers.length === 0) {
    return []
  }

  logger.debug('Fetching MCP tools for assistant', { serverCount: servers.length })

  const results = await Promise.allSettled(servers.map((server) => mcpService.listTools(null as never, server)))

  const tools: MCPTool[] = []
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === 'fulfilled') {
      tools.push(...result.value)
    } else {
      logger.warn('Failed to fetch tools from MCP server', {
        serverId: servers[i].id,
        serverName: servers[i].name,
        error: result.reason
      })
    }
  }

  logger.debug('Built MCP tools for assistant', { toolCount: tools.length })
  return tools
}

/**
 * Apply assistant overrides to request params based on input format
 *
 * Only handles format-specific field differences:
 * - System prompt: system (Anthropic) / instructions (Responses) / messages[0] (OpenAI)
 * - MaxTokens: max_tokens / max_output_tokens
 *
 * AI SDK's MessageConverter handles the rest of the parameter transformations.
 */
function applyAssistantOverrides(params: InputParams, assistant: Assistant, inputFormat: InputFormat): InputParams {
  const nextParams = { ...params } as Record<string, unknown>
  const settings = assistant.settings ?? {}
  const prompt = assistant.prompt?.trim() ?? ''

  // 1. System prompt (format-specific field)
  if (prompt.length > 0) {
    if (inputFormat === 'openai') {
      const messages = Array.isArray(nextParams.messages) ? [...nextParams.messages] : []
      const filtered = messages.filter((m: { role?: string }) => m?.role !== 'system' && m?.role !== 'developer')
      filtered.unshift({ role: 'system', content: prompt })
      nextParams.messages = filtered
    } else if (inputFormat === 'openai-responses') {
      nextParams.instructions = prompt
    } else {
      nextParams.system = prompt
    }
  }

  // 2. Stream output
  if (typeof settings.streamOutput === 'boolean') {
    nextParams.stream = settings.streamOutput
  }

  // 3. Temperature
  if (settings.enableTemperature && typeof settings.temperature === 'number') {
    nextParams.temperature = settings.temperature
  }

  // 4. TopP
  if (settings.enableTopP && typeof settings.topP === 'number') {
    nextParams.top_p = settings.topP
  }

  // 5. MaxTokens (format-specific field name)
  if (settings.enableMaxTokens && typeof settings.maxTokens === 'number') {
    if (inputFormat === 'openai-responses') {
      nextParams.max_output_tokens = settings.maxTokens
    } else {
      nextParams.max_tokens = settings.maxTokens
    }
  }

  return nextParams as InputParams
}

/**
 * Middleware type alias
 */
type LanguageModelMiddleware = LanguageModelV2Middleware

/**
 * Union type for all supported input params
 */
type InputParams = InputParamsMap[InputFormat]

/**
 * Configuration for message requests (both streaming and non-streaming)
 */
export interface MessageConfig {
  response: Response
  provider?: Provider
  modelId?: string
  params: InputParams
  inputFormat?: InputFormat
  outputFormat?: OutputFormat
  onError?: (error: unknown) => void
  onComplete?: () => void
  middlewares?: LanguageModelMiddleware[]
  plugins?: AiPlugin[]
}

/**
 * Internal configuration for stream execution
 */
interface ExecuteStreamConfig {
  provider: Provider
  modelId: string
  params: InputParams
  inputFormat: InputFormat
  outputFormat: OutputFormat
  middlewares?: LanguageModelMiddleware[]
  plugins?: AiPlugin[]
  abortSignal?: AbortSignal
}

// ============================================================================
// Provider Configuration
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

function isSupportStreamOptionsProvider(provider: MinimalProvider): boolean {
  const NOT_SUPPORT_STREAM_OPTIONS_PROVIDERS = ['mistral'] as const
  return !NOT_SUPPORT_STREAM_OPTIONS_PROVIDERS.some((pid) => pid === provider.id)
}

const mainProcessSdkContext: AiSdkConfigContext = {
  isSupportStreamOptionsProvider,
  getIncludeUsageSetting: () =>
    reduxService.selectSync<boolean | undefined>('state.settings.openAI?.streamOptions?.includeUsage'),
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

/**
 * Create AI SDK provider instance from config
 */
async function createAiSdkProvider(config: AiSdkConfig): Promise<AiSdkProvider> {
  let providerId = config.providerId

  // Handle special provider modes
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
        const { token } = await copilotService.getToken(null as never, headers)
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

// ============================================================================
// Core Stream Execution
// ============================================================================

/**
 * Execute stream and return adapter with output stream
 *
 * Uses MessageConverterFactory to create the appropriate converter
 * based on input format, eliminating format-specific if-else logic.
 */
async function executeStream(config: ExecuteStreamConfig): Promise<{
  adapter: IStreamAdapter
  outputStream: ReadableStream<unknown>
}> {
  const { provider, modelId, params, inputFormat, outputFormat, middlewares = [], plugins = [], abortSignal } = config

  // Convert provider config to AI SDK config
  let sdkConfig = providerToAiSdkConfig(provider, modelId)
  sdkConfig = await prepareSpecialProviderConfig(provider, sdkConfig)

  // Create provider instance and get language model
  const aiSdkProvider = await createAiSdkProvider(sdkConfig)
  const baseModel = aiSdkProvider.languageModel(modelId)

  // Apply middlewares if present
  const model =
    middlewares.length > 0 && typeof baseModel === 'object'
      ? (wrapLanguageModel({ model: baseModel, middleware: middlewares as never }) as typeof baseModel)
      : baseModel

  // Create executor with plugins
  const executor = createExecutor(sdkConfig.providerId, sdkConfig.options, plugins)

  const converter = MessageConverterFactory.create(inputFormat, {
    googleReasoningCache,
    openRouterReasoningCache
  })

  // Convert messages, tools, and extract options using unified interface
  const coreMessages = converter.toAiSdkMessages(params)
  const tools = converter.toAiSdkTools?.(params)
  const streamOptions = converter.extractStreamOptions(params)
  const providerOptions = converter.extractProviderOptions(provider, params)

  // Create adapter via factory
  const adapter = StreamAdapterFactory.createAdapter(outputFormat, {
    model: `${provider.id}:${modelId}`
  })

  // Execute AI SDK stream with extracted options
  const result = await executor.streamText({
    model,
    messages: coreMessages,
    ...streamOptions,
    stopWhen: stepCountIs(100),
    headers: defaultAppHeaders(),
    tools,
    providerOptions,
    abortSignal
  })

  // Transform stream using adapter
  const outputStream = adapter.transform(result.fullStream)

  return { adapter, outputStream }
}

/**
 * Process a message request - handles both streaming and non-streaming
 *
 * Automatically detects streaming mode from params.stream:
 * - stream=true: SSE streaming response
 * - stream=false: JSON response
 */
export async function processMessage(config: MessageConfig): Promise<void> {
  const {
    response,
    inputFormat = 'anthropic',
    outputFormat = 'anthropic',
    onError,
    onComplete,
    middlewares = [],
    plugins = []
  } = config

  let { provider, modelId, params } = config

  // Check if model starts with "assistant:" prefix - auto-detect assistant mode
  const modelFromParams = 'model' in params ? (params as { model?: string }).model : undefined
  const isAssistantMode = modelFromParams?.startsWith('assistant:')

  // Handle assistant mode: resolve assistant config and apply overrides
  if (isAssistantMode) {
    const assistantId = modelFromParams!.slice('assistant:'.length)

    const assistant = await resolveAssistantById(assistantId)
    if (!assistant) {
      throw new Error(`Assistant '${assistantId}' not found`)
    }

    // Get model from assistant config
    const assistantModel = assistant.model ?? assistant.defaultModel
    if (!assistantModel?.provider || !assistantModel?.id) {
      throw new Error(`Assistant '${assistantId}' is missing a model configuration`)
    }

    // Resolve provider
    const resolvedProvider = await getProviderById(assistantModel.provider)
    if (!resolvedProvider) {
      throw new Error(`Provider '${assistantModel.provider}' not found for assistant '${assistantId}'`)
    }

    provider = resolvedProvider
    modelId = assistantModel.id

    // Apply assistant overrides to params
    params = applyAssistantOverrides(params, assistant, inputFormat)

    // Build and inject MCP tools
    const assistantTools = await buildAssistantTools(assistant)
    if (assistantTools.length > 0) {
      // Inject tools based on input format
      const paramsWithTools = { ...params } as Record<string, unknown>
      if (inputFormat === 'openai') {
        paramsWithTools.tools = assistantTools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description || '',
            parameters: tool.inputSchema
          }
        }))
      } else if (inputFormat === 'openai-responses') {
        paramsWithTools.tools = assistantTools.map((tool) => ({
          type: 'function',
          name: tool.name,
          description: tool.description || '',
          parameters: tool.inputSchema
        }))
      } else {
        // anthropic
        paramsWithTools.tools = assistantTools.map((tool) => ({
          name: tool.name,
          description: tool.description || '',
          input_schema: tool.inputSchema
        }))
      }
      params = paramsWithTools as InputParams
    }

    logger.debug('Resolved assistant config', {
      assistantId,
      providerId: provider.id,
      modelId,
      toolCount: assistantTools.length
    })
  }

  if (!provider || !modelId) {
    throw new Error('Provider and modelId are required when not using assistant mode')
  }

  const isStreaming = 'stream' in params && params.stream === true

  logger.info(`Starting ${isStreaming ? 'streaming' : 'non-streaming'} message`, {
    providerId: provider.id,
    providerType: provider.type,
    modelId,
    inputFormat,
    outputFormat,
    middlewareCount: middlewares.length,
    pluginCount: plugins.length,
    assistantMode: isAssistantMode
  })

  // Create abort controller with timeout
  const streamController = createStreamAbortController({ timeoutMs: LONG_POLL_TIMEOUT_MS })
  const { abortController, dispose } = streamController

  const handleDisconnect = () => {
    if (abortController.signal.aborted) return
    logger.info('Client disconnected, aborting', { providerId: provider.id, modelId })
    abortController.abort('Client disconnected')
  }

  response.on('close', handleDisconnect)

  try {
    // For non-streaming, add simulateStreamingMiddleware
    const allMiddlewares = isStreaming ? middlewares : [simulateStreamingMiddleware(), ...middlewares]

    const { adapter, outputStream } = await executeStream({
      provider,
      modelId,
      params,
      inputFormat,
      outputFormat,
      middlewares: allMiddlewares,
      plugins,
      abortSignal: abortController.signal
    })

    if (isStreaming) {
      // Streaming: Set SSE headers and stream events
      response.setHeader('Content-Type', 'text/event-stream')
      response.setHeader('Cache-Control', 'no-cache')
      response.setHeader('Connection', 'keep-alive')
      response.setHeader('X-Accel-Buffering', 'no')

      const formatter = StreamAdapterFactory.getFormatter(outputFormat)
      const reader = outputStream.getReader()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (response.writableEnded) break
          response.write(formatter.formatEvent(value))
        }
      } finally {
        reader.releaseLock()
      }

      if (!response.writableEnded) {
        response.write(formatter.formatDone())
        response.end()
      }
    } else {
      // Non-streaming: Consume stream and return JSON
      const reader = outputStream.getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }
      reader.releaseLock()

      const finalResponse = adapter.buildNonStreamingResponse()
      response.json(finalResponse)
    }

    logger.info('Message completed', { providerId: provider.id, modelId, streaming: isStreaming })
    onComplete?.()
  } catch (error) {
    logger.error('Error in message processing', error as Error, { providerId: provider.id, modelId })
    onError?.(error)
    throw error
  } finally {
    response.off('close', handleDisconnect)
    dispose()
  }
}

export default {
  processMessage
}
