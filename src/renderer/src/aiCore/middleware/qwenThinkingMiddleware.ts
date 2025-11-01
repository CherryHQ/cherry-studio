import type { LanguageModelMiddleware } from 'ai'

/**
 * Qwen Thinking Middleware
 * Controls thinking mode for Qwen models on providers that don't support enable_thinking parameter (like Ollama)
 * Appends '/think' or '/no_think' suffix to user messages based on reasoning_effort setting
 * @param enableThinking - Whether thinking mode is enabled (based on reasoning_effort !== undefined)
 * @returns LanguageModelMiddleware
 */
export function qwenThinkingMiddleware(enableThinking: boolean): LanguageModelMiddleware {
  const suffix = enableThinking ? ' /think' : ' /no_think'

  return {
    middlewareVersion: 'v2',

    transformParams: async ({ params }) => {
      const transformedParams = { ...params }
      // Process messages in prompt
      if (transformedParams.prompt && Array.isArray(transformedParams.prompt)) {
        transformedParams.prompt = transformedParams.prompt.map((message) => {
          // Only process user messages
          if (message.role === 'user') {
            // Process content array
            if (Array.isArray(message.content)) {
              for (const part of message.content) {
                if (part.type === 'text' && !part.text.endsWith('/think') && !part.text.endsWith('/no_think')) {
                  part.text += suffix
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
