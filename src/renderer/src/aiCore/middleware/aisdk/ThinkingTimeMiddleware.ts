import { LanguageModelV1Middleware, LanguageModelV1StreamPart } from '@cherrystudio/ai-core'

/**
 * 一个用于统计 LLM "思考时间"（Time to First Token）的 AI SDK 中间件。
 *
 * 工作原理:
 * 1. 在 `stream` 方法被调用时，记录一个起始时间。
 * 2. 它会创建一个新的 `TransformStream` 来代理原始的流。
 * 3. 当第一个数据块 (chunk) 从原始流中到达时，记录结束时间。
 * 4. 计算两者之差，即为 "思考时间"
 * 这里只处理了thinking_complete
 */
export default function thinkingTimeMiddleware(): LanguageModelV1Middleware {
  return {
    wrapStream: async ({ doStream }) => {
      let hasThinkingContent = false
      let thinkingStartTime = 0
      let accumulatedThinkingContent = ''
      const { stream, ...reset } = await doStream()
      const transformStream = new TransformStream<LanguageModelV1StreamPart, any>({
        transform(chunk, controller) {
          if (chunk.type === 'reasoning' || chunk.type === 'redacted-reasoning') {
            if (!hasThinkingContent) {
              hasThinkingContent = true
              thinkingStartTime = Date.now()
            }
            accumulatedThinkingContent += chunk.textDelta || ''
            // 将所有 chunk 原样传递下去
            controller.enqueue(chunk)
          } else {
            if (hasThinkingContent && thinkingStartTime > 0) {
              const thinkingTime = Date.now() - thinkingStartTime
              const thinkingCompleteChunk = {
                type: 'reasoning-signature',
                text: accumulatedThinkingContent,
                thinking_millsec: thinkingTime
              }
              controller.enqueue(thinkingCompleteChunk)
              hasThinkingContent = false
              thinkingStartTime = 0
              accumulatedThinkingContent = ''
            } else {
              controller.enqueue(chunk)
            }
          }
        },
        flush(controller) {
          // 如果流的末尾都是 reasoning，也需要发送 complete 事件
          if (hasThinkingContent && thinkingStartTime > 0) {
            const thinkingTime = Date.now() - thinkingStartTime
            const thinkingCompleteChunk = {
              type: 'reasoning-signature',
              text: accumulatedThinkingContent,
              thinking_millsec: thinkingTime
            }
            controller.enqueue(thinkingCompleteChunk)
          }
          controller.terminate()
        }
      })

      return {
        stream: stream.pipeThrough(transformStream),
        ...reset
      }
    }
  }
}
