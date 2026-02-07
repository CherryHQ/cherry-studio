import { loggerService } from '@logger'
import type { LanguageModelMiddleware } from 'ai'

const logger = loggerService.withContext('skipGeminiThoughtSignatureMiddleware')

/**
 * skip Gemini Thought Signature Middleware
 * 由于多模型客户端请求的复杂性（可以中途切换其他模型），这里选择通过中间件方式添加跳过所有 Gemini3 思考签名
 * Due to the complexity of multi-model client requests (which can switch to other models mid-process),
 * it was decided to add a skip for all Gemini3 thinking signatures via middleware.
 *
 * Handles multiple cases:
 * 1. Parts from a previous Gemini response that already have providerOptions.google.thoughtSignature
 *    -> Replace with magic string to skip validation
 * 2. Reasoning parts from conversation replay (ThinkingMessageBlock -> { type: 'reasoning' })
 *    that have NO providerOptions at all (lost during message serialization/deserialization)
 *    -> Add providerOptions with magic string
 * 3. Tool-call parts that need thought_signature for OpenAI-compatible API
 *    -> Add providerOptions.openaiCompatible.extra_content.google.thought_signature
 *
 * @param aiSdkId AI SDK Provider ID
 * @returns LanguageModelMiddleware
 */
export function skipGeminiThoughtSignatureMiddleware(aiSdkId: string): LanguageModelMiddleware {
  const MAGIC_STRING = 'skip_thought_signature_validator'
  return {
    middlewareVersion: 'v2',

    transformParams: async ({ params }) => {
      const transformedParams = { ...params }
      logger.debug('transformedParams', transformedParams)
      // Process messages in prompt
      if (transformedParams.prompt && Array.isArray(transformedParams.prompt)) {
        transformedParams.prompt = transformedParams.prompt.map((message) => {
          if (typeof message.content !== 'string') {
            for (const part of message.content) {
              const hasExistingSignature = part?.providerOptions?.[aiSdkId]?.thoughtSignature
              const isReasoningPart = part.type === 'reasoning'
              const isToolCallPart = part.type === 'tool-call'

              // Case 1 & 2: Native Gemini path - add thoughtSignature to google providerOptions
              if (hasExistingSignature || isReasoningPart) {
                if (!part.providerOptions) {
                  part.providerOptions = {}
                }
                if (!part.providerOptions[aiSdkId]) {
                  part.providerOptions[aiSdkId] = {}
                }
                part.providerOptions[aiSdkId].thoughtSignature = MAGIC_STRING
              }

              // Case 3: OpenAI-compatible path - add extra_content for tool-call parts
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
