import type { LanguageModelMiddleware } from 'ai'

export function noThinkMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      const transformedParams = { ...params }

      if (transformedParams.prompt && Array.isArray(transformedParams.prompt)) {
        transformedParams.prompt = transformedParams.prompt.map((message) => {
          if (message.role === 'user' && Array.isArray(message.content)) {
            const lastContent = message.content[message.content.length - 1]
            if (lastContent && lastContent.type === 'text' && typeof lastContent.text === 'string') {
              if (!lastContent.text.endsWith('/no_think')) {
                return {
                  ...message,
                  content: [
                    ...message.content.slice(0, -1),
                    {
                      ...lastContent,
                      text: `${lastContent.text} /no_think`
                    }
                  ]
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
