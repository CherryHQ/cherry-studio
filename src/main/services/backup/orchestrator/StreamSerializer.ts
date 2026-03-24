/**
 * StreamSerializer
 * Handles streaming JSONL serialization with backpressure support
 */

import type { TransformOptions } from 'node:stream'
import { Transform, Writable } from 'node:stream'

/**
 * Transform stream for stringifying objects to JSONL format
 * Extends Transform to handle object-to-string conversion
 */
export class JsonlStringifier extends Transform {
  private separator: Buffer

  constructor(opts?: TransformOptions) {
    super({
      ...opts,
      objectMode: true,
      writableObjectMode: true
    })
    this.separator = Buffer.from('\n')
  }

  /**
   * Transform override - converts objects to JSONL lines
   */
  _transform(
    chunk: Record<string, unknown>,
    _encoding: string,
    callback: (error?: Error | null, data?: unknown) => void
  ): void {
    try {
      const line = JSON.stringify(chunk)
      const buffer = Buffer.from(line)
      this.push(buffer)
      this.push(this.separator)
      callback()
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)))
    }
  }
}

/**
 * Options for writeToStream
 */
interface WriteToStreamOptions {
  /** High water mark for the stringifier */
  highWaterMark?: number
  /** Whether to throw on backpressure */
  throwOnBackpressure?: boolean
}

/**
 * Writes objects to a writable stream as JSONL
 * Handles backpressure automatically
 * @param stream - Target writable stream
 * @param data - Iterable of objects to write
 * @param options - Writing options
 */
export async function writeToStream<T extends Record<string, unknown>>(
  stream: Writable,
  data: Iterable<T> | AsyncIterable<T>,
  options: WriteToStreamOptions = {}
): Promise<void> {
  const { highWaterMark = 16384, throwOnBackpressure = false } = options

  const stringifier = new JsonlStringifier({
    highWaterMark,
    writableObjectMode: true
  })

  // Track backpressure
  let canContinue = true

  stringifier.on('drain', () => {
    canContinue = true
  })

  stringifier.pipe(stream)

  for await (const item of data) {
    // Wait for drain if there's backpressure
    if (!canContinue && throwOnBackpressure) {
      throw new Error('Backpressure: stream buffer full')
    }

    if (!canContinue) {
      await new Promise<void>((resolve) => {
        stringifier.once('drain', resolve)
      })
    }

    canContinue = stringifier.write(item)
  }

  stringifier.end()
}

/**
 * Creates a writable stream that collects JSONL lines
 * Useful for testing or small data
 */
export function createJsonlCollector(onComplete: (lines: string[]) => void): Writable {
  const lines: string[] = []

  return new Writable({
    objectMode: false,
    write(chunk: Buffer, _encoding, callback) {
      const linesWithNewline = chunk.toString('utf-8').split('\n')
      // Remove empty last element if chunk ends with newline
      if (linesWithNewline.length > 0 && linesWithNewline[linesWithNewline.length - 1] === '') {
        linesWithNewline.pop()
      }
      lines.push(...linesWithNewline)
      callback()
    },
    final(callback) {
      onComplete(lines)
      callback()
    }
  })
}

/**
 * Batch write objects to JSONL with configurable batch size
 * Useful for memory-efficient large data processing
 * @param stream - Target writable stream
 * @param data - Iterable of objects
 * @param batchSize - Number of objects per batch
 */
export async function writeBatchToStream<T extends Record<string, unknown>>(
  stream: Writable,
  data: Iterable<T> | AsyncIterable<T>,
  batchSize: number = 1000
): Promise<void> {
  const batch: T[] = []

  for await (const item of data) {
    batch.push(item)

    if (batch.length >= batchSize) {
      await writeToStream(stream, batch)
      batch.length = 0
    }
  }

  // Write remaining items
  if (batch.length > 0) {
    await writeToStream(stream, batch)
  }
}
