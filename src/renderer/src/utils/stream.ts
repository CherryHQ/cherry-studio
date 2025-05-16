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

export function asyncGeneratorToReadableStream<T>(gen: AsyncGenerator<T>): ReadableStream<T> {
  return new ReadableStream<T>({
    async pull(controller) {
      const { value, done } = await gen.next()
      if (done) {
        controller.close()
      } else {
        controller.enqueue(value)
      }
    }
  })
}
