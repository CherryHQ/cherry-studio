import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

import { hashDbFile } from '@data/db/restore/hashDbFile'

import { BackupCancelledError } from './errors'

/** The repository-standard streaming SHA-256 used for the sealed SQLite payload. */
export const sha256File = hashDbFile

/** Test seam for deterministic cancellation while hashing a large DB. */
export const hashStreamHooks = {
  onChunk(_bytesSoFar: number): void {
    void _bytesSoFar
  }
}

/** Streaming SHA-256 that observes cancellation on every chunk. */
export async function sha256FileCancellable(filePath: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new BackupCancelledError()
  const hash = createHash('sha256')
  let bytes = 0
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk: string | Buffer) => {
      bytes += Buffer.byteLength(chunk)
      hash.update(chunk)
      hashStreamHooks.onChunk(bytes)
      if (signal?.aborted) stream.destroy(new BackupCancelledError())
    })
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}
