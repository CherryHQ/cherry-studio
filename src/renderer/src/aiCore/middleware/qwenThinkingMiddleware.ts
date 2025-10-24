import { loggerService } from '@logger'
import { LanguageModelMiddleware } from 'ai'

const logger = loggerService.withContext('qwenThinkingMiddleware')

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
              const lastContent = message.content[message.content.length - 1]
              // If the last content is text type, append the appropriate suffix
              if (lastContent && lastContent.type === 'text' && typeof lastContent.text === 'string') {
                // Avoid duplicate additions
                if (!lastContent.text.endsWith('/think') && !lastContent.text.endsWith('/no_think')) {
                  logger.debug(`Adding ${suffix} to user message`)
                  return {
                    ...message,
                    content: [
                      ...message.content.slice(0, -1),
                      {
                        ...lastContent,
                        text: lastContent.text + suffix
                      }
                    ]
                  }
                }
              }
            } else if (typeof message.content === 'string') {
              // Handle string content
              if (!message.content.endsWith('/think') && !message.content.endsWith('/no_think')) {
                logger.debug(`Adding ${suffix} to user message`)
                return {
                  ...message,
                  content: message.content + suffix
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
