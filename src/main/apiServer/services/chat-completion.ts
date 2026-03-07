import OpenAI from '@cherrystudio/openai'
import type { ChatCompletionCreateParams, ChatCompletionCreateParamsStreaming } from '@cherrystudio/openai/resources'
import type { Provider } from '@types'

import { loggerService } from '../../services/LoggerService'
import type { ModelValidationError } from '../utils'
import { validateModelId } from '../utils'

const logger = loggerService.withContext('ChatCompletionService')
const MOONSHOT_PROVIDER_ID = 'moonshot'
const MOONSHOT_WEB_SEARCH_TOOL_NAME = '$web_search'
const MOONSHOT_WEB_SEARCH_TOOL = {
  type: 'builtin_function',
  function: { name: MOONSHOT_WEB_SEARCH_TOOL_NAME }
} as const

type ChatCompletionTool = NonNullable<ChatCompletionCreateParams['tools']>[number]
type ChatCompletionMessage = NonNullable<ChatCompletionCreateParams['messages']>[number]

function isMoonshotProvider(provider: Provider): boolean {
  if (provider.id === MOONSHOT_PROVIDER_ID) {
    return true
  }

  const apiHost = provider.apiHost
  if (!apiHost || typeof apiHost !== 'string') {
    return false
  }

  try {
    const hostname = new URL(apiHost).hostname
    return hostname === 'moonshot.cn' || hostname.endsWith('.moonshot.cn')
  } catch {
    return apiHost.includes('moonshot.cn')
  }
}

function isMoonshotWebSearchTool(tool: unknown): boolean {
  if (!tool || typeof tool !== 'object') {
    return false
  }

  const candidate = tool as { type?: unknown; function?: { name?: unknown } }
  return candidate.type === 'builtin_function' && candidate.function?.name === MOONSHOT_WEB_SEARCH_TOOL_NAME
}

export function normalizeMoonshotBuiltinSearchTool<T extends ChatCompletionCreateParams>(
  request: T,
  provider: Provider
): T {
  if (!isMoonshotProvider(provider)) {
    return request
  }

  const normalizedMessages = normalizeMoonshotMessages(request.messages)
  let normalizedRequest = request
  if (normalizedMessages.hasChanges) {
    normalizedRequest = {
      ...request,
      messages: normalizedMessages.messages
    } as T
  }

  const currentTools = Array.isArray(normalizedRequest.tools) ? [...normalizedRequest.tools] : []
  const hasBuiltinWebSearch = currentTools.some(isMoonshotWebSearchTool)
  const shouldInject = normalizedRequest.tool_choice !== 'none' && !hasBuiltinWebSearch

  logger.debug('Moonshot builtin web search tool normalization', {
    providerId: provider.id,
    toolChoice: normalizedRequest.tool_choice,
    toolCountBefore: currentTools.length,
    hasBuiltinWebSearch,
    shouldInject,
    hasNormalizedMessages: normalizedMessages.hasChanges
  })

  if (!shouldInject) {
    return normalizedRequest
  }

  const normalizedTools = [...currentTools, MOONSHOT_WEB_SEARCH_TOOL as unknown as ChatCompletionTool]
  logger.debug('Moonshot builtin web search tool injected', {
    providerId: provider.id,
    toolCountAfter: normalizedTools.length
  })

  return {
    ...normalizedRequest,
    tools: normalizedTools
  }
}

function normalizeMoonshotMessages(messages: ChatCompletionCreateParams['messages'] | undefined): {
  messages: ChatCompletionMessage[]
  hasChanges: boolean
} {
  if (!Array.isArray(messages)) {
    return { messages: [], hasChanges: false }
  }

  const toolCallNameById = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue
    }
    const toolCalls = (message as { tool_calls?: unknown }).tool_calls
    if (!Array.isArray(toolCalls)) {
      continue
    }

    for (const toolCall of toolCalls) {
      if (!toolCall || typeof toolCall !== 'object') {
        continue
      }
      const candidate = toolCall as { id?: unknown; function?: { name?: unknown } }
      if (typeof candidate.id === 'string' && typeof candidate.function?.name === 'string') {
        toolCallNameById.set(candidate.id, candidate.function.name)
      }
    }
  }

  let hasChanges = false
  const normalizedMessages = messages.map((message) => {
    if (message.role === 'assistant') {
      const toolCalls = (message as { tool_calls?: unknown }).tool_calls
      if (Array.isArray(toolCalls)) {
        let assistantHasChanges = false
        const normalizedToolCalls = toolCalls.map((toolCall) => {
          if (!toolCall || typeof toolCall !== 'object') {
            return toolCall
          }

          const candidate = toolCall as { type?: unknown; function?: { name?: unknown } }
          if (candidate.function?.name === MOONSHOT_WEB_SEARCH_TOOL_NAME && candidate.type !== 'builtin_function') {
            assistantHasChanges = true
            return {
              ...candidate,
              type: 'builtin_function'
            }
          }

          return toolCall
        })

        if (assistantHasChanges) {
          hasChanges = true
          return {
            ...message,
            tool_calls: normalizedToolCalls
          } as ChatCompletionMessage
        }
      }
    }

    if (message.role !== 'tool') {
      return message
    }

    const candidate = message as { name?: unknown; tool_call_id?: unknown }
    if (typeof candidate.name === 'string' || typeof candidate.tool_call_id !== 'string') {
      return message
    }

    const toolName = toolCallNameById.get(candidate.tool_call_id)
    if (!toolName) {
      return message
    }

    hasChanges = true
    return {
      ...message,
      name: toolName
    } as ChatCompletionMessage
  })

  return {
    messages: normalizedMessages,
    hasChanges
  }
}

export interface ValidationResult {
  isValid: boolean
  errors: string[]
}

export class ChatCompletionValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Request validation failed: ${errors.join('; ')}`)
    this.name = 'ChatCompletionValidationError'
  }
}

export class ChatCompletionModelError extends Error {
  constructor(public readonly error: ModelValidationError) {
    super(`Model validation failed: ${error.message}`)
    this.name = 'ChatCompletionModelError'
  }
}

export type PrepareRequestResult =
  | { status: 'validation_error'; errors: string[] }
  | { status: 'model_error'; error: ModelValidationError }
  | {
      status: 'ok'
      provider: Provider
      modelId: string
      client: OpenAI
      providerRequest: ChatCompletionCreateParams
    }

export class ChatCompletionService {
  async resolveProviderContext(
    model: string
  ): Promise<
    { ok: false; error: ModelValidationError } | { ok: true; provider: Provider; modelId: string; client: OpenAI }
  > {
    const modelValidation = await validateModelId(model)
    if (!modelValidation.valid) {
      return {
        ok: false,
        error: modelValidation.error!
      }
    }

    const provider = modelValidation.provider!

    if (provider.type !== 'openai') {
      return {
        ok: false,
        error: {
          type: 'unsupported_provider_type',
          message: `Provider '${provider.id}' of type '${provider.type}' is not supported for OpenAI chat completions`,
          code: 'unsupported_provider_type'
        }
      }
    }

    const modelId = modelValidation.modelId!

    const client = new OpenAI({
      baseURL: provider.apiHost,
      apiKey: provider.apiKey
    })

    return {
      ok: true,
      provider,
      modelId,
      client
    }
  }

  async prepareRequest(request: ChatCompletionCreateParams, stream: boolean): Promise<PrepareRequestResult> {
    const requestValidation = this.validateRequest(request)
    if (!requestValidation.isValid) {
      return {
        status: 'validation_error',
        errors: requestValidation.errors
      }
    }

    const providerContext = await this.resolveProviderContext(request.model!)
    if (!providerContext.ok) {
      return {
        status: 'model_error',
        error: providerContext.error
      }
    }

    const { provider, modelId, client } = providerContext

    logger.debug('Model validation successful', {
      provider: provider.id,
      providerType: provider.type,
      modelId,
      fullModelId: request.model
    })

    const providerRequest = normalizeMoonshotBuiltinSearchTool(
      stream
        ? {
            ...request,
            model: modelId,
            stream: true as const
          }
        : {
            ...request,
            model: modelId,
            stream: false as const
          },
      provider
    )

    return {
      status: 'ok',
      provider,
      modelId,
      client,
      providerRequest
    }
  }

  validateRequest(request: ChatCompletionCreateParams): ValidationResult {
    const errors: string[] = []

    // Only validate minimal structure required for routing.
    // Detailed message validation is delegated to the upstream provider.
    if (!request.messages) {
      errors.push('Messages array is required')
    } else if (!Array.isArray(request.messages)) {
      errors.push('Messages must be an array')
    } else if (request.messages.length === 0) {
      errors.push('Messages array cannot be empty')
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  async processCompletion(request: ChatCompletionCreateParams): Promise<{
    provider: Provider
    modelId: string
    response: OpenAI.Chat.Completions.ChatCompletion
  }> {
    try {
      logger.debug('Processing chat completion request', {
        model: request.model,
        messageCount: request.messages.length,
        stream: request.stream
      })

      const preparation = await this.prepareRequest(request, false)
      if (preparation.status === 'validation_error') {
        throw new ChatCompletionValidationError(preparation.errors)
      }

      if (preparation.status === 'model_error') {
        throw new ChatCompletionModelError(preparation.error)
      }

      const { provider, modelId, client, providerRequest } = preparation

      logger.debug('Sending request to provider', {
        provider: provider.id,
        model: modelId,
        apiHost: provider.apiHost
      })

      const response = (await client.chat.completions.create(providerRequest)) as OpenAI.Chat.Completions.ChatCompletion

      logger.info('Chat completion processed', {
        modelId,
        provider: provider.id
      })
      return {
        provider,
        modelId,
        response
      }
    } catch (error: any) {
      logger.error('Error processing chat completion', {
        error,
        model: request.model
      })
      throw error
    }
  }

  async processStreamingCompletion(request: ChatCompletionCreateParams): Promise<{
    provider: Provider
    modelId: string
    stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
  }> {
    try {
      logger.debug('Processing streaming chat completion request', {
        model: request.model,
        messageCount: request.messages.length
      })

      const preparation = await this.prepareRequest(request, true)
      if (preparation.status === 'validation_error') {
        throw new ChatCompletionValidationError(preparation.errors)
      }

      if (preparation.status === 'model_error') {
        throw new ChatCompletionModelError(preparation.error)
      }

      const { provider, modelId, client, providerRequest } = preparation

      logger.debug('Sending streaming request to provider', {
        provider: provider.id,
        model: modelId,
        apiHost: provider.apiHost
      })

      const streamRequest = providerRequest as ChatCompletionCreateParamsStreaming
      const stream = (await client.chat.completions.create(
        streamRequest
      )) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>

      logger.info('Streaming chat completion started', {
        modelId,
        provider: provider.id
      })
      return {
        provider,
        modelId,
        stream
      }
    } catch (error: any) {
      logger.error('Error processing streaming chat completion', {
        error,
        model: request.model
      })
      throw error
    }
  }
}

// Export singleton instance
export const chatCompletionService = new ChatCompletionService()
