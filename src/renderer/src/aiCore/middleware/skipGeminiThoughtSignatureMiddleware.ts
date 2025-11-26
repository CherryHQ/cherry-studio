import type { LanguageModelMiddleware } from 'ai'

/**
 * skip Gemini Thought Signature Middleware
 * 由于多模型客户端请求的复杂性（可以中途切换其他模型），这里选择通过中间件方式添加跳过所有 Gemini3 思考签名
 * Due to the complexity of multi-model client requests (which can switch to other models mid-process),
 * it was decided to add a skip for all Gemini3 thinking signatures via middleware.
 * @param aiSdkId AI SDK Provider ID
 * @returns LanguageModelMiddleware
 */
export function skipGeminiThoughtSignatureMiddleware(aiSdkId: string): LanguageModelMiddleware {
  const MAGIC_STRING = 'skip_thought_signature_validator'
  return {
    middlewareVersion: 'v2',

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
