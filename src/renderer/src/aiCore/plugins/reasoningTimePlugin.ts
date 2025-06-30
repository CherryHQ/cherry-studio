import { definePlugin } from '@cherrystudio/ai-core'

export default definePlugin({
  name: 'reasoningTimePlugin',
  transformStream: () => () => {
    let thinkingStartTime = performance.now()
    let hasStartedThinking = false
    let accumulatedThinkingContent = ''
    return new TransformStream({
      transform(chunk, controller) {
        if (chunk.type === 'reasoning') {
          if (!hasStartedThinking) {
            hasStartedThinking = true
            // thinkingStartTime = performance.now()
          }
          accumulatedThinkingContent += chunk.textDelta
          console.log('performance.now() - thinkingStartTime', performance.now() - thinkingStartTime)
          controller.enqueue({
            ...chunk,
            thinking_millsec: performance.now() - thinkingStartTime
          })
        } else if (hasStartedThinking && accumulatedThinkingContent) {
          controller.enqueue({
            type: 'reasoning-signature',
            text: accumulatedThinkingContent,
            thinking_millsec: performance.now() - thinkingStartTime
          })
          accumulatedThinkingContent = ''
          hasStartedThinking = false
          thinkingStartTime = 0
          controller.enqueue(chunk)
        } else {
          controller.enqueue(chunk)
        }
      }
    })
  }
})
