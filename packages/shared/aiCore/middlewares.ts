/**
 * Shared AI SDK Middlewares
 *
 * These middlewares are environment-agnostic and can be used in both
 * renderer process and main process (API server).
 */
import type { LanguageModelMiddleware } from 'ai'
import { extractReasoningMiddleware } from 'ai'

import { getReasoningTagName, isGemini3ModelId } from './utils'

/**
 * Configuration for building shared middlewares
 */
export interface SharedMiddlewareConfig {
  /**
   * Whether to enable reasoning extraction
   */
  enableReasoning?: boolean

  /**
   * Tag name for reasoning extraction
   * Defaults based on model ID
   */
  reasoningTagName?: string

  /**
   * Model ID - used to determine default reasoning tag and model detection
   */
  modelId?: string

  /**
   * Provider ID (Cherry Studio provider ID)
   * Used for provider-specific middlewares like OpenRouter
   */
  providerId?: string

  /**
   * AI SDK Provider ID
   * Used for Gemini thought signature middleware
   * e.g., 'google', 'google-vertex'
   */
  aiSdkProviderId?: string
}

/**
 * Skip Gemini Thought Signature Middleware
 *
 * Due to the complexity of multi-model client requests (which can switch
 * to other models mid-process), this middleware skips all Gemini 3
 * thinking signatures validation.
 *
 * @param aiSdkId - AI SDK Provider ID (e.g., 'google', 'google-vertex')
 * @returns LanguageModelV2Middleware
 */
export function skipGeminiThoughtSignatureMiddleware(aiSdkId: string): LanguageModelMiddleware {
  const MAGIC_STRING = 'skip_thought_signature_validator'
  return {
    specificationVersion: 'v3',

    transformParams: async ({ params }) => {
      const transformedParams = { ...params }
      // Process messages in prompt
      if (transformedParams.prompt && Array.isArray(transformedParams.prompt)) {
        transformedParams.prompt = transformedParams.prompt.map((message) => {
          if (typeof message.content !== 'string') {
            for (const part of message.content) {
              const googleOptions = part?.providerOptions?.[aiSdkId]
              if (googleOptions?.thoughtSignature) {
                googleOptions.thoughtSignature = MAGIC_STRING
              }
            }
          }
          return message
        })
      }

      return transformedParams
    }
  }
}

/**
 * OpenRouter Reasoning Middleware
 *
 * Filters out [REDACTED] blocks from OpenRouter reasoning responses.
 * OpenRouter may include [REDACTED] markers in reasoning content that
 * should be removed for cleaner output.
 *
 * @see https://openrouter.ai/docs/docs/best-practices/reasoning-tokens
 * @returns LanguageModelV2Middleware
 */
export function openrouterReasoningMiddleware(): LanguageModelMiddleware {
  const REDACTED_BLOCK = '[REDACTED]'
  return {
    specificationVersion: 'v3',
    wrapGenerate: async ({ doGenerate }) => {
      const { content, ...rest } = await doGenerate()
      const modifiedContent = content.map((part) => {
        if (part.type === 'reasoning' && part.text.includes(REDACTED_BLOCK)) {
          return {
            ...part,
            text: part.text.replace(REDACTED_BLOCK, '')
          }
        }
        return part
      })
      return { content: modifiedContent, ...rest }
    },
    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream()
      return {
        stream: stream.pipeThrough(
          new TransformStream<any, any>({
            transform(chunk: any, controller: TransformStreamDefaultController<any>) {
              if (chunk.type === 'reasoning-delta' && chunk.delta.includes(REDACTED_BLOCK)) {
                controller.enqueue({
                  ...chunk,
                  delta: chunk.delta.replace(REDACTED_BLOCK, '')
                })
              } else {
                controller.enqueue(chunk)
              }
            }
          })
        ),
        ...rest
      }
    }
  }
}

/**
 * Build shared middlewares based on configuration
 *
 * This function builds a set of middlewares that are commonly needed
 * across different environments (renderer, API server).
 *
 * @param config - Configuration for middleware building
 * @returns Array of AI SDK middlewares
 *
 * @example
 * ```typescript
 * import { buildSharedMiddlewares } from '@shared/middleware'
 *
 * const middlewares = buildSharedMiddlewares({
 *   enableReasoning: true,
 *   modelId: 'gemini-2.5-pro',
 *   providerId: 'openrouter',
 *   aiSdkProviderId: 'google'
 * })
 * ```
 */
export function buildSharedMiddlewares(config: SharedMiddlewareConfig): LanguageModelMiddleware[] {
  const middlewares: LanguageModelMiddleware[] = []

  // 1. Reasoning extraction middleware
  if (config.enableReasoning) {
    const tagName = config.reasoningTagName || getReasoningTagName(config.modelId)
    middlewares.push(extractReasoningMiddleware({ tagName }))
  }

  // 2. OpenRouter-specific: filter [REDACTED] blocks
  if (config.providerId === 'openrouter' && config.enableReasoning) {
    middlewares.push(openrouterReasoningMiddleware())
  }

  // 3. Gemini 3 (2.5) specific: skip thought signature validation
  if (isGemini3ModelId(config.modelId) && config.aiSdkProviderId) {
    middlewares.push(skipGeminiThoughtSignatureMiddleware(config.aiSdkProviderId))
  }

  return middlewares
}
