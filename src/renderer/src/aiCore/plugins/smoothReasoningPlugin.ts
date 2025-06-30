import { definePlugin } from '@cherrystudio/ai-core'

export default definePlugin(({ delayInMs, chunkingRegex }: { delayInMs: number; chunkingRegex: RegExp }) => ({
  name: 'smoothReasoningPlugin',

  transformStream: () => () => {
    let buffer = ''
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const detectChunk = (buffer: string) => {
      const match = chunkingRegex.exec(buffer)

      if (!match) {
        return null
      }

      return buffer.slice(0, match.index) + match?.[0]
    }
    return new TransformStream({
      async transform(chunk, controller) {
        if (chunk.type !== 'reasoning') {
          if (buffer.length > 0) {
            controller.enqueue({ type: 'reasoning', textDelta: buffer })
            buffer = ''
          }

          controller.enqueue(chunk)
          return
        }

        buffer += chunk.textDelta
        let match

        while ((match = detectChunk(buffer)) != null) {
          controller.enqueue({ type: 'reasoning', textDelta: match })
          buffer = buffer.slice(match.length)

          await delay(delayInMs)
        }
      }
    })
  }
}))
