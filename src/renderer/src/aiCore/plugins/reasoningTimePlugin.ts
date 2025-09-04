import { definePlugin } from '@cherrystudio/ai-core'
import type { TextStreamPart, ToolSet } from 'ai'

export default definePlugin({
  name: 'reasoningTimePlugin',

  transformStream: () => () => {
    // === 时间跟踪状态 ===
    let thinkingStartTime = 0
    let hasStartedThinking = false
    let accumulatedThinkingContent = ''
    let reasoningBlockId = ''

    return new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
      transform(chunk: TextStreamPart<ToolSet>, controller: TransformStreamDefaultController<TextStreamPart<ToolSet>>) {
        // === 处理 reasoning 类型 ===
        if (chunk.type === 'reasoning-start') {
          controller.enqueue(chunk)
          hasStartedThinking = true
          thinkingStartTime = performance.now()
          reasoningBlockId = chunk.id
        } else if (chunk.type === 'reasoning-delta') {
          accumulatedThinkingContent += chunk.text
          controller.enqueue({
            ...chunk,
            providerMetadata: {
              ...chunk.providerMetadata,
              metadata: {
                ...chunk.providerMetadata?.metadata,
                thinking_millsec: performance.now() - thinkingStartTime,
                thinking_content: accumulatedThinkingContent
              }
            }
          })
        } else if (chunk.type === 'reasoning-end' && hasStartedThinking) {
          controller.enqueue({
            type: 'reasoning-end',
            id: reasoningBlockId,
            providerMetadata: {
              metadata: {
                thinking_millsec: performance.now() - thinkingStartTime,
                thinking_content: accumulatedThinkingContent
              }
            }
          })
          accumulatedThinkingContent = ''
          hasStartedThinking = false
          thinkingStartTime = 0
          reasoningBlockId = ''
        } else {
          controller.enqueue(chunk)
        }
      }
    })
  }
})
