import { definePlugin } from '@cherrystudio/ai-core'

const chunkingRegex = /([\u4E00-\u9FFF])|\S+\s+/
const delayInMs = 20

export default definePlugin({
  name: 'reasoningPlugin',

  transformStream: () => () => {
    // === smoothing 状态 ===
    let buffer = ''

    // === 时间跟踪状态 ===
    let thinkingStartTime = performance.now()
    let hasStartedThinking = false
    let accumulatedThinkingContent = ''

    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    const detectChunk = (buffer: string) => {
      const match = chunkingRegex.exec(buffer)
      if (!match) return null
      return buffer.slice(0, match.index) + match?.[0]
    }

    return new TransformStream({
      async transform(chunk, controller) {
        if (chunk.type !== 'reasoning') {
          // === 处理 reasoning 结束  ===
          if (hasStartedThinking && accumulatedThinkingContent) {
            // 先输出剩余的 buffer
            if (buffer.length > 0) {
              controller.enqueue({
                type: 'reasoning',
                textDelta: buffer,
                thinking_millsec: performance.now() - thinkingStartTime
              })
              buffer = ''
            }

            // 生成 reasoning-signature
            controller.enqueue({
              type: 'reasoning-signature',
              text: accumulatedThinkingContent,
              thinking_millsec: performance.now() - thinkingStartTime
            })

            // 重置状态
            accumulatedThinkingContent = ''
            hasStartedThinking = false
            thinkingStartTime = 0
          }

          controller.enqueue(chunk)
          return
        }

        // === 处理 reasoning 类型 ===

        // 1. 时间跟踪逻辑
        if (!hasStartedThinking) {
          hasStartedThinking = true
          thinkingStartTime = performance.now()
        }
        accumulatedThinkingContent += chunk.textDelta

        // 2. Smooth 处理逻辑
        buffer += chunk.textDelta
        let match

        while ((match = detectChunk(buffer)) != null) {
          controller.enqueue({
            type: 'reasoning',
            textDelta: match,
            thinking_millsec: performance.now() - thinkingStartTime
          })
          buffer = buffer.slice(match.length)

          await delay(delayInMs)
        }
      },

      // === flush 处理剩余 buffer ===
      flush(controller) {
        if (buffer.length > 0) {
          controller.enqueue({
            type: 'reasoning',
            textDelta: buffer,
            thinking_millsec: hasStartedThinking ? performance.now() - thinkingStartTime : 0
          })
        }
      }
    })
  }
})
