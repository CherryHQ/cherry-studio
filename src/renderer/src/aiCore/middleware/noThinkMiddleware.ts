import { loggerService } from '@logger'
import type { LanguageModelMiddleware } from 'ai'

const logger = loggerService.withContext('noThinkMiddleware')

/**
 * No Think Middleware
 * Automatically appends ' /no_think' string to the end of user messages for the provider
 * This prevents the model from generating unnecessary thinking process and returns results directly
 * @returns LanguageModelMiddleware
 */
export function noThinkMiddleware(): LanguageModelMiddleware {
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
              // If the last content is text type, append ' /no_think'
              if (lastContent && lastContent.type === 'text' && typeof lastContent.text === 'string') {
                // Avoid duplicate additions
                if (!lastContent.text.endsWith('/no_think')) {
                  logger.debug('Adding /no_think to user message')
                  return {
                    ...message,
                    content: [
                      ...message.content.slice(0, -1),
                      {
                        ...lastContent,
                        text: lastContent.text + ' /no_think'
                      }
                    ]
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
