import { convertLinks } from '@renderer/utils/linkConverter'

// 支持泛型 T，默认 T = { type: string; textDelta: string }
export function convertLinksMiddleware<T extends { type: string } = { type: string; textDelta: string }>() {
  return {
    wrapStream: async ({
      doStream
    }: {
      doStream: () => Promise<{ stream: ReadableStream<T> } & Record<string, any>>
    }) => {
      const { stream, ...rest } = await doStream()
      return {
        stream: stream.pipeThrough(
          new TransformStream<T, T>({
            transform: (chunk, controller) => {
              if (chunk.type === 'text-delta') {
                controller.enqueue({
                  ...chunk,
                  // @ts-expect-error: textDelta 只在 text-delta chunk 上
                  textDelta: convertLinks(chunk.textDelta)
                })
              } else {
                controller.enqueue(chunk)
              }
            }
          })
        ),
        ...rest
      }
    }
  }
}
