// https://github.com/ant-design/x/blob/main/components/x-stream/index.ts
/**
 * @description default separator for {@link splitStream}
 */
const DEFAULT_STREAM_SEPARATOR = '\n\n'
/**
 * @description Default separator for {@link splitPart}
 * @example "event: delta\ndata: {\"key\": \"value\"}"
 */
const DEFAULT_PART_SEPARATOR = '\n'
/**
 * @description Default separator for key value, A colon (`:`) is used to separate keys from values
 * @example "event: delta"
 */
const DEFAULT_KV_SEPARATOR = ':'

/**
 * Check if a string is not empty or only contains whitespace characters
 */
const isValidString = (str: string) => (str ?? '').trim() !== ''

/**
 * @description A TransformStream inst that splits a stream into parts based on {@link DEFAULT_STREAM_SEPARATOR}
 * @example
 *
 * `event: delta
 * data: { content: 'hello' }
 *
 * event: delta
 * data: { key: 'world!' }
 *
 * `
 */
function splitStream() {
  // Buffer to store incomplete data chunks between transformations
  let buffer = ''

  return new TransformStream<string, string>({
    transform(streamChunk, controller) {
      buffer += streamChunk

      // Split the buffer based on the separator
      const parts = buffer.split(DEFAULT_STREAM_SEPARATOR)

      // Enqueue all complete parts except for the last incomplete one
      parts.slice(0, -1).forEach((part) => {
        // Skip empty parts
        if (isValidString(part)) {
          controller.enqueue(part)
        }
      })

      // Save the last incomplete part back to the buffer for the next chunk
      buffer = parts[parts.length - 1]
    },
    flush(controller) {
      // If there's any remaining data in the buffer, enqueue it as the final part
      if (isValidString(buffer)) {
        controller.enqueue(buffer)
      }
    }
  })
}

/**
 * @link https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#fields
 */
export type SSEFields = 'data' | 'event' | 'id' | 'retry'

/**
 * @example
 * const sseObject = {
 *    event: 'delta',
 *    data: '{ key: "world!" }',
 * };
 */
export type SSEOutput = Partial<Record<SSEFields, any>>

/**
 * @description A TransformStream inst that transforms a part string into {@link SSEOutput}
 * @example part string
 *
 * "event: delta\ndata: { key: 'world!' }\n"
 *
 * @link https://developer.mozilla.org/en-US/docs/Web/API/EventSource
 *
 * When handling responses with `Content-Type: text/event-stream`, the following standard practices are commonly observed:
 * - Double newline characters (`\n\n`) are used to separate individual events.
 * - Single newline characters (`\n`) are employed to separate line within an event.
 */
function splitPart() {
  return new TransformStream<string, SSEOutput>({
    transform(partChunk, controller) {
      // Split the chunk into key-value pairs using the partSeparator
      const lines = partChunk.split(DEFAULT_PART_SEPARATOR)

      const sseEvent = lines.reduce((acc, line) => {
        const separatorIndex = line.indexOf(DEFAULT_KV_SEPARATOR)

        if (separatorIndex === -1) {
          throw new Error(`The key-value separator "${DEFAULT_KV_SEPARATOR}" is not found in the sse line chunk!`)
        }

        // Extract the key from the beginning of the line up to the separator
        const key = line.slice(0, separatorIndex)

        // The colon is used for comment lines, skip directly
        if (!isValidString(key)) return acc

        // Extract the value from the line after the separator
        const value = line.slice(separatorIndex + 1)

        return { ...acc, [key]: value }
      }, {})

      if (Object.keys(sseEvent).length === 0) return

      // Reduce the key-value pairs into a single object and enqueue
      controller.enqueue(sseEvent)
    }
  })
}

export interface XStreamOptions<Output> {
  /**
   * @description Readable stream of binary data
   * @link https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream
   */
  readableStream: ReadableStream<Uint8Array>

  /**
   * @description Support customizable transformStream to transform streams
   * @default sseTransformStream
   * @link https://developer.mozilla.org/en-US/docs/Web/API/TransformStream
   */
  transformStream?: TransformStream<string, Output>
}

type XReadableStream<R = SSEOutput> = ReadableStream<R> & AsyncGenerator<R>

/**
 * @description Transform Uint8Array binary stream to {@link SSEOutput} by default
 * @warning The `XStream` only support the `utf-8` encoding. More encoding support maybe in the future.
 */
function XStream<Output = SSEOutput>(options: XStreamOptions<Output>) {
  const { readableStream, transformStream } = options

  if (!(readableStream instanceof ReadableStream)) {
    throw new Error('The options.readableStream must be an instance of ReadableStream.')
  }

  // Default encoding is `utf-8`
  const decoderStream = new TextDecoderStream()

  const stream = (
    transformStream
      ? /**
         * Uint8Array binary -> string -> Output
         */
        readableStream.pipeThrough(decoderStream).pipeThrough(transformStream)
      : /**
         * Uint8Array binary -> string -> SSE part string -> Default Output {@link SSEOutput}
         */
        readableStream.pipeThrough(decoderStream).pipeThrough(splitStream()).pipeThrough(splitPart())
  ) as XReadableStream<Output>

  /** support async iterator */
  stream[Symbol.asyncIterator] = async function* () {
    const reader = this.getReader()

    while (true) {
      const { done, value } = await reader.read()

      if (done) break

      if (!value) continue

      // Transformed data through all transform pipes
      yield value
    }
  }

  return stream
}

export default XStream
