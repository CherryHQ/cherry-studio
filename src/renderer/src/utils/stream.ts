/**
 * Most browsers don't yet have async iterable support for ReadableStream,
 * and Node has a very different way of reading bytes from its "ReadableStream".
 *
 * This polyfill was pulled from https://github.com/MattiasBuelens/web-streams-polyfill/pull/122#issuecomment-1627354490
 */
export function readableStreamAsyncIterable<T>(stream: any): AsyncIterableIterator<T> {
  if (stream[Symbol.asyncIterator]) return stream

  const reader = stream.getReader()
  return {
    async next() {
      try {
        const result = await reader.read()
        if (result?.done) reader.releaseLock() // release lock when stream becomes closed
        return result
      } catch (e) {
        reader.releaseLock() // release lock when stream becomes errored
        throw e
      }
    },
    async return() {
      const cancelPromise = reader.cancel()
      reader.releaseLock()
      await cancelPromise
      return { done: true, value: undefined }
    },
    [Symbol.asyncIterator]() {
      return this
    }
  }
}

export function asyncGeneratorToReadableStream<T>(gen: AsyncIterable<T>): ReadableStream<T> {
  const iterator = gen[Symbol.asyncIterator]()

  return new ReadableStream<T>({
    async pull(controller) {
      const { value, done } = await iterator.next()
      if (done) {
        controller.close()
      } else {
        controller.enqueue(value)
      }
    }
  })
}

/**
 * 将单个数据项转换为可读流
 * @param data 要转换为流的单个数据项
 * @returns 包含单个数据项的ReadableStream
 */
export function createSingleChunkReadableStream<T>(data: T): ReadableStream<T> {
  return new ReadableStream<T>({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    }
  })
}
