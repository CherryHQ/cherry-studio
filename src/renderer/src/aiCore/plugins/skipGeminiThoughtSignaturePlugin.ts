import { definePlugin } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import type { LanguageModelMiddleware } from 'ai'

const logger = loggerService.withContext('skipGeminiThoughtSignaturePlugin')

/**
 * skip Gemini Thought Signature Middleware
 *
 * Handles:
 * - Tool-call parts need thought_signature for OpenAI-compatible API
 *   -> Add providerOptions.openaiCompatible.extra_content.google.thought_signature
 *
 * Note: Thought signature for text/reasoning parts is now handled in messageConverter.
 *
 * @returns LanguageModelMiddleware
 */
function createSkipGeminiThoughtSignatureMiddleware(): LanguageModelMiddleware {
  const MAGIC_STRING = 'skip_thought_signature_validator'
  return {
    specificationVersion: 'v3',

    transformParams: async ({ params }) => {
      const transformedParams = { ...params }
      logger.debug('transformedParams', transformedParams)
      // Process messages in prompt
      if (transformedParams.prompt && Array.isArray(transformedParams.prompt)) {
        transformedParams.prompt = transformedParams.prompt.map((message) => {
          if (typeof message.content !== 'string') {
            for (const part of message.content) {
              const isToolCallPart = part.type === 'tool-call'

              // Note: text part and reasoning part do not require thought signature validation
              // They are handled by messageConverter now

              // Case: OpenAI-compatible path - add extra_content for tool-call parts
              // All tool-calls need the signature for Gemini OpenAI-compatible API
              if (isToolCallPart) {
                if (!part.providerOptions) {
                  part.providerOptions = {}
                }
                if (!part.providerOptions.openaiCompatible) {
                  part.providerOptions.openaiCompatible = {}
                }
                // Google OpenAI-compatible API expects extra_content.google.thought_signature
                // See: https://ai.google.dev/gemini-api/docs/thought-signatures#openai
                part.providerOptions.openaiCompatible.extra_content = {
                  google: {
                    thought_signature: MAGIC_STRING
                  }
                }
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

export const createSkipGeminiThoughtSignaturePlugin = () =>
  definePlugin({
    name: 'skipGeminiThoughtSignature',
    enforce: 'pre',

    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(createSkipGeminiThoughtSignatureMiddleware())
    }
  })
