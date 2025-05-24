import { Chunk, ErrorChunk } from '@renderer/types/chunk'
import { Message } from '@renderer/types/newMessage'

import { CompletionsParams } from '../../AiProvider'
import { CompletionsMiddleware } from '../middlewareTypes'

/**
 * Helper to get message content safely for logging. /
 * 安全地获取消息内容用于日志记录的辅助函数。
 * @param message - The message object. / 消息对象。
 * @returns A string representation of the message content, truncated if necessary. / 消息内容的字符串表示形式，如有必要则进行截断。
 */
const getMessageContentForCompletionsLogging = (message: Message | any): string => {
  if (!message) return '[Null/Undefined Message]'
  if (typeof message.content === 'string') {
    return message.content.substring(0, 100) + (message.content.length > 100 ? '...' : '')
  }
  if (
    Array.isArray(message.blocks) &&
    message.blocks.length > 0 &&
    message.blocks[0] &&
    typeof message.blocks[0].text === 'string'
  ) {
    return message.blocks[0].text.substring(0, 50) + (message.blocks[0].text.length > 50 ? '...' : '')
  }
  if (message.role && typeof message.role === 'string') {
    return `[Message Role: ${message.role}]`
  }
  return '[Unable to display message content]' // Fallback if content cannot be extracted / 如果无法提取内容则回退
}

/**
 * Creates a logging middleware specifically for the `completions` method. /
 * 为 `completions` 方法创建一个专用的日志中间件。
 * This middleware logs details about the `completions` call, including messages and `onChunk` events. /
 * 此中间件记录有关 `completions` 调用的详细信息，包括消息和 `onChunk` 事件。
 * @returns A `CompletionsMiddleware` instance. / 一个 `CompletionsMiddleware` 实例。
 */
export const createCompletionsLoggingMiddleware: () => CompletionsMiddleware = () => {
  const middlewareName = 'CompletionsLoggingMiddleware'

  return (/* _: MiddlewareAPI<AiProviderMiddlewareCompletionsContext, [CompletionsParams]> */) => {
    // const providerId = _.getProviderId(); // Can be used if needed, for example, to enrich logPrefix / 如果需要，可以使用，例如丰富logPrefix
    return (next) => {
      return async (context, params) => {
        const assistantId = context.assistant?.id || 'unknown-assistant'
        const modelId = context.model?.id || 'unknown-model'
        const logPrefix = `[${middlewareName} (${assistantId}-${modelId})]`

        console.log(
          `${logPrefix} Initiating 'completions'. Messages:`,
          context.messages?.map(getMessageContentForCompletionsLogging) || '[No Messages]'
        )
        // console.log(`${logPrefix} Full Params:`, params); // Optionally log full params for more detail / 可选择记录完整参数以获取更多详细信息

        let loggedOnChunk: ((chunk: Chunk | ErrorChunk) => void) | undefined = params.onChunk
        if (params.onChunk) {
          const originalOnChunk = params.onChunk
          loggedOnChunk = (chunk: Chunk | ErrorChunk) => {
            let logDetails: any = ''
            if (chunk.type === 'error' && 'error' in chunk) {
              logDetails = chunk.error
            } else if ('response' in chunk && chunk.response && typeof chunk.response.text === 'string') {
              logDetails = chunk.response.text?.substring(0, 50) // Log a snippet of the chunk text / 记录一部分块文本
            } else if (chunk.type) {
              logDetails = `[Chunk type: ${chunk.type}]`
            }
            console.log(`${logPrefix} onChunk: type=${chunk.type}`, logDetails)
            originalOnChunk(chunk) // Call the original onChunk handler / 调用原始的onChunk处理函数
          }
        }

        // Pass the potentially wrapped onChunk to the next middleware or final method / 将可能被包装的onChunk传递给下一个中间件或最终方法
        const newParams: CompletionsParams = { ...params, onChunk: loggedOnChunk }

        const startTime = Date.now()
        try {
          // 调用 next 并存储其结果
          const result = await next(context, newParams)
          const duration = Date.now() - startTime
          console.log(`${logPrefix} 'completions' successful. Duration: ${duration}ms`)
          return result // 返回 next 的结果
        } catch (error) {
          const duration = Date.now() - startTime
          console.error(`${logPrefix} 'completions' failed. Duration: ${duration}ms`, error)
          throw error
        }
      }
    }
  }
}
