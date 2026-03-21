import type { LanguageModelMiddleware } from 'ai'

export function qwenThinkingMiddleware(enableThinking: boolean): LanguageModelMiddleware {
  const suffix = enableThinking ? ' /think' : ' /no_think'

  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      const transformedParams = { ...params }

      if (transformedParams.prompt && Array.isArray(transformedParams.prompt)) {
        transformedParams.prompt = transformedParams.prompt.map((message) => {
          if (message.role === 'user' && Array.isArray(message.content)) {
            for (const part of message.content) {
              if (part.type === 'text' && !part.text.endsWith('/think') && !part.text.endsWith('/no_think')) {
                part.text += suffix
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
