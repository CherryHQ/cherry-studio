import path from 'node:path'
import type { Readable } from 'node:stream'
import { Transform } from 'node:stream'

import type { AbsoluteFilePath } from '@shared/types/file'
import { ZipArchive } from 'archiver'

import { createAtomicWriteStream } from './fs'

export interface AtomicZipBufferEntry {
  readonly name: string
  readonly data: Buffer | string
}

export interface AtomicZipStreamEntry {
  readonly name: string
  readonly expectedBytes: number
  readonly createReadStream: () => Readable
}

export type AtomicZipEntry = AtomicZipBufferEntry | AtomicZipStreamEntry

export class FixedLengthReadError extends Error {
  constructor(cause: unknown) {
    super('Failed to read a fixed-length file snapshot', { cause })
  }
}

function assertSafeArchiveName(name: string): void {
  const segments = name.split('/')
  if (
    !name ||
    path.posix.isAbsolute(name) ||
    name.includes('\\') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('Invalid ZIP entry name')
  }
}

function exactLengthStream(expectedBytes: number, onFailure: (error: FixedLengthReadError) => void): Transform {
  let bytesRead = 0
  const fail = (message: string, callback: (error?: Error | null) => void) => {
    const error = new FixedLengthReadError(new Error(message))
    onFailure(error)
    callback(error)
  }

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytesRead += chunk.length
      if (bytesRead > expectedBytes) {
        fail('File stream exceeded its fixed snapshot', callback)
      } else {
        callback(null, chunk)
      }
    },
    flush(callback) {
      if (bytesRead !== expectedBytes) {
        fail('File stream ended before its fixed snapshot', callback)
      } else {
        callback()
      }
    }
  })
}

function appendStreamAndWait(
  archive: ZipArchive,
  output: ReturnType<typeof createAtomicWriteStream>,
  name: string,
  source: Readable,
  counted: Transform,
  onReadFailure: (error: unknown) => FixedLengthReadError
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      archive.off('entry', onEntry)
      archive.off('error', onError)
      archive.off('warning', onError)
      output.off('error', onError)
      counted.off('error', onError)
    }
    const onEntry = (entry: { name?: string }) => {
      if (entry.name !== name) return
      cleanup()
      resolve()
    }
    const onError = (error: unknown) => {
      cleanup()
      reject(error)
    }

    archive.on('entry', onEntry)
    archive.once('error', onError)
    archive.once('warning', onError)
    output.once('error', onError)
    counted.once('error', onError)
    source.once('error', (error) => counted.destroy(onReadFailure(error)))

    try {
      source.pipe(counted)
      archive.append(counted, { name })
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

/**
 * Write a ZIP through the shared atomic file primitive. Stream entries are
 * opened and consumed sequentially, then length-checked, so large entry counts
 * cannot exhaust file descriptors and a failed read cannot publish a partial
 * archive.
 */
export async function writeAtomicZip(destination: AbsoluteFilePath, entries: readonly AtomicZipEntry[]): Promise<void> {
  for (const entry of entries) assertSafeArchiveName(entry.name)

  const output = createAtomicWriteStream(destination)
  const archive = new ZipArchive({ zlib: { level: 1 } })
  const activeStreams = new Set<Readable>()
  let rejectCompletion: (error: unknown) => void = () => undefined
  const completion = new Promise<void>((resolve, reject) => {
    rejectCompletion = reject
    output.once('finish', resolve)
    output.once('error', reject)
    archive.once('error', reject)
    archive.once('warning', reject)
  })
  void completion.catch(() => undefined)
  const failRead = (error: unknown): FixedLengthReadError => {
    const failure = error instanceof FixedLengthReadError ? error : new FixedLengthReadError(error)
    rejectCompletion(failure)
    return failure
  }

  try {
    archive.pipe(output)
    for (const entry of entries) {
      if ('data' in entry) {
        archive.append(entry.data, { name: entry.name })
        continue
      }
      if (entry.expectedBytes === 0) {
        archive.append(Buffer.alloc(0), { name: entry.name })
        continue
      }

      let source: Readable
      try {
        source = entry.createReadStream()
      } catch (error) {
        throw new FixedLengthReadError(error)
      }
      const counted = exactLengthStream(entry.expectedBytes, failRead)
      activeStreams.add(source)
      activeStreams.add(counted)
      await appendStreamAndWait(archive, output, entry.name, source, counted, failRead)
      activeStreams.delete(source)
      activeStreams.delete(counted)
    }
    await Promise.all([archive.finalize(), completion])
  } catch (error) {
    for (const stream of activeStreams) stream.destroy()
    archive.abort()
    if (!output.closed) await output.abort().catch(() => undefined)
    throw error
  }
}
