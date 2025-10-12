import { loggerService } from '@logger'
import { LanguageModelMiddleware } from 'ai'

const logger = loggerService.withContext('noThinkMiddleware')

/**
 * No Think 中间件
 * 为 provider 的用户消息自动在最后添加 ' /no_think' 字符串
 * 这可以防止模型生成不必要的思考过程，直接返回结果
 * @returns LanguageModelMiddleware
 */
export function noThinkMiddleware(): LanguageModelMiddleware {
  return {
    middlewareVersion: 'v2',

    transformParams: async ({ params }) => {
      const transformedParams = { ...params }
      // 处理 prompt 中的消息
      if (transformedParams.prompt && Array.isArray(transformedParams.prompt)) {
        transformedParams.prompt = transformedParams.prompt.map((message) => {
          // 只处理用户消息
          if (message.role === 'user') {
            // 处理 content 数组
            if (Array.isArray(message.content)) {
              const lastContent = message.content[message.content.length - 1]
              // 如果最后一个内容是文本类型，追加 ' /no_think'
              if (lastContent && lastContent.type === 'text' && typeof lastContent.text === 'string') {
                // 避免重复添加
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
