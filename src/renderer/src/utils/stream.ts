export function readableStreamAsyncIterable<T>(stream: ReadableStream<T>): AsyncIterable<T> {
  const reader = stream.getReader()
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        async next(): Promise<IteratorResult<T>> {
          return reader.read() as Promise<IteratorResult<T>>
        }
      }
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
