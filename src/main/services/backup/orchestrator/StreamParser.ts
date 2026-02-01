/**
 * StreamParser
 * Handles parsing JSONL streams with error handling and skip support
 */

import type { Readable, TransformOptions } from 'node:stream'
import { Transform } from 'node:stream'

/**
 * Transform stream for parsing JSONL to objects
 */
export class JsonlParser extends Transform {
  private buffer: string
  private lineNumber: number

  constructor(opts?: TransformOptions) {
    super({
      ...opts,
      objectMode: true,
      readableObjectMode: true
    })
    this.buffer = ''
    this.lineNumber = 0
  }

  /**
   * Transform override - parses JSONL lines to objects
   */
  _transform(chunk: Buffer, _encoding: string, callback: (error?: Error | null, data?: unknown) => void): void {
    const text = chunk.toString('utf-8')
    this.buffer += text

    const lines = this.buffer.split('\n')
    // Keep the last partial line in the buffer
    this.buffer = lines.pop() || ''

    for (const line of lines) {
      this.lineNumber++

      if (line.trim() === '') {
        continue
      }

      try {
        const obj = JSON.parse(line)
        this.push(obj)
      } catch (error) {
        // Emit error but continue parsing
        this.emit(
          'parseError',
          new JsonParseError(
            `Failed to parse JSONL at line ${this.lineNumber}: ${(error as Error).message}`,
            line,
            this.lineNumber
          )
        )
      }
    }

    callback()
  }

  /**
   * Flush any remaining buffered data
   */
  _flush(callback: (error?: Error | null) => void): void {
    if (this.buffer.trim() !== '') {
      this.lineNumber++
      try {
        const obj = JSON.parse(this.buffer)
        this.push(obj)
      } catch (error) {
        this.emit(
          'parseError',
          new JsonParseError(
            `Failed to parse final JSONL at line ${this.lineNumber}: ${(error as Error).message}`,
            this.buffer,
            this.lineNumber
          )
        )
      }
    }
    callback()
  }
}

/**
 * Error class for JSON parsing errors
 */
export class JsonParseError extends Error {
  line: string
  lineNumber: number

  constructor(message: string, line: string, lineNumber: number) {
    super(message)
    this.name = 'JsonParseError'
    this.line = line
    this.lineNumber = lineNumber
  }
}

/**
 * Options for parseJsonlStream
 */
interface ParseJsonlStreamOptions {
  /** Skip lines that fail to parse */
  skipErrors?: boolean
  /** Transform parsed objects before emitting */
  transform?: (obj: Record<string, unknown>, lineNumber: number) => Record<string, unknown>
}

/**
 * Parses a readable stream as JSONL
 * @param stream - Readable stream containing JSONL data
 * @param options - Parsing options
 * @returns Async iterable of parsed objects
 */
export function parseJsonlStream(
  stream: Readable,
  options: ParseJsonlStreamOptions = {}
): AsyncIterable<Record<string, unknown>> {
  const { skipErrors = true, transform } = options
  const parser = new JsonlParser({ objectMode: true })

  const iterator: AsyncIterator<Record<string, unknown>> = {
    async next() {
      for await (const chunk of stream) {
        // Handle chunks from the parser
        if (typeof chunk === 'object' && chunk !== null) {
          let result = chunk as Record<string, unknown>
          if (transform) {
            result = transform(result, 0)
          }
          return { done: false, value: result }
        }
      }
      return { done: true, value: undefined }
    }
  }

  stream.pipe(parser)

  if (skipErrors) {
    parser.on('parseError', () => {
      // Silently skip errors when skipErrors is true
    })
  }

  return {
    [Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>> {
      return iterator
    }
  }
}

/**
 * Parses JSONL data from a ZIP file entry
 * @param zipEntry - ZIP file entry (from yauzl or unzipper)
 * @returns Promise resolving to parsed objects
 */
export async function parseJsonlFromZip(zipEntry: {
  read: (buffer: Buffer, callback: (err: Error | null, bytesRead: number, buffer: Buffer) => void) => void
  on: (event: string, callback: (data: Buffer) => void) => void
}): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = []
  const chunks: Buffer[] = []

  return new Promise((resolve, reject) => {
    zipEntry.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    zipEntry.on('end', () => {
      const fullBuffer = Buffer.concat(chunks)
      const text = fullBuffer.toString('utf-8')
      const lines = text.split('\n')

      for (const line of lines) {
        if (line.trim() === '') continue
        try {
          results.push(JSON.parse(line))
        } catch (error) {
          // Skip malformed lines
        }
      }

      resolve(results)
    })

    zipEntry.on('error', reject)

    // Read the entry (yauzl pattern)
    const buffer = Buffer.alloc(65536)
    zipEntry.read(buffer, () => {
      // Reading will trigger 'data' events
    })
  })
}

/**
 * Reads all JSONL lines from a file (for small files only)
 * @param filePath - Path to the JSONL file
 * @param skipErrors - Whether to skip parse errors
 * @returns Promise resolving to parsed objects
 */
export async function readJsonlAll(filePath: string, skipErrors: boolean = true): Promise<Record<string, unknown>[]> {
  const { readFile } = await import('node:fs/promises')
  const text = await readFile(filePath, 'utf-8')
  const lines = text.split('\n')
  const results: Record<string, unknown>[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '') continue

    try {
      results.push(JSON.parse(line))
    } catch (error) {
      if (!skipErrors) {
        throw new JsonParseError(`Failed to parse JSONL at line ${i + 1}: ${(error as Error).message}`, line, i + 1)
      }
    }
  }

  return results
}

/**
 * Creates a transform stream that filters JSONL objects
 * @param predicate - Function to test each object
 * @returns Transform stream
 */
export function createJsonlFilter(predicate: (obj: Record<string, unknown>) => boolean): Transform {
  return new Transform({
    objectMode: true,
    writableObjectMode: true,
    readableObjectMode: true,
    transform(chunk, _encoding, callback) {
      if (predicate(chunk as Record<string, unknown>)) {
        this.push(chunk)
      }
      callback()
    }
  })
}

/**
 * Creates a transform stream that maps JSONL objects
 * @param mapper - Function to transform each object
 * @returns Transform stream
 */
export function createJsonlMapper<T, R>(mapper: (obj: T) => R): Transform {
  return new Transform({
    objectMode: true,
    writableObjectMode: true,
    readableObjectMode: true,
    transform(chunk, _encoding, callback) {
      this.push(mapper(chunk as T))
      callback()
    }
  })
}
