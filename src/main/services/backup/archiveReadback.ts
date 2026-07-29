import { createHash, type Hash } from 'node:crypto'
import type { Readable } from 'node:stream'

import { type NormalizedEntry, openArchive, validateArchiveShape } from './admission/catalog'
import { classifyPayloadLayout } from './admission/layout'
import { DB_ENTRY } from './archiveLayout'
import { BACKUP_CEILINGS } from './ceilings'
import { BackupCancelledError, ManifestPayloadMismatchError } from './errors'
import type { BackupManifest, ResourcePayload } from './manifest'

/**
 * Read-back verification of the ZIP bytes immediately before publication.
 *
 * Source staging is verified before packaging, but that alone cannot detect a
 * truncated/corrupt archive write. This verifier reopens the finished temp ZIP,
 * validates its duplicate-preserving catalog, then streams every payload back
 * through the same canonical hashes advertised by the manifest.
 */

export interface ArchiveReadbackCeilings {
  readonly maxArchiveEntries: number
  readonly maxEntryUncompressedBytes: number
  readonly maxTotalUncompressedBytes: number
  readonly maxManifestBytes: number
  readonly maxPathDepth: number
  readonly maxPathLength: number
}

interface VerifyArchiveReadbackInputs {
  readonly archivePath: string
  readonly manifest: BackupManifest
  readonly manifestBytes: Buffer
  readonly ceilings: ArchiveReadbackCeilings
  readonly signal?: AbortSignal
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new BackupCancelledError()
}

function u64be(value: number): Buffer {
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64BE(BigInt(value))
  return bytes
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function streamEntry(zip: Awaited<ReturnType<typeof openArchive>>['zip'], entry: NormalizedEntry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.stream(entry.zipEntry, (error, stream) => {
      if (error || !stream) {
        reject(new ManifestPayloadMismatchError('packaged archive entry could not be read back'))
        return
      }
      // node-stream-zip's declaration exposes only NodeJS.ReadableStream,
      // while the implementation returns a real Node Readable (destroyable
      // and async-iterable). Keep the narrow cast at the library boundary.
      resolve(stream as Readable)
    })
  })
}

async function consumeEntry(args: {
  readonly zip: Awaited<ReturnType<typeof openArchive>>['zip']
  readonly entry: NormalizedEntry
  readonly signal?: AbortSignal
  readonly hash?: Hash
  readonly collect?: boolean
}): Promise<{ readonly sizeBytes: number; readonly bytes?: Buffer }> {
  const { zip, entry, signal, hash, collect = false } = args
  throwIfAborted(signal)
  const stream = await streamEntry(zip, entry)
  const chunks: Buffer[] = []
  let sizeBytes = 0
  const onAbort = (): void => {
    stream.destroy(new BackupCancelledError())
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    for await (const chunk of stream) {
      throwIfAborted(signal)
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      sizeBytes += bytes.length
      if (sizeBytes > entry.uncompressedSize) {
        throw new ManifestPayloadMismatchError(`packaged entry exceeded its catalog size: ${entry.path}`)
      }
      hash?.update(bytes)
      if (collect) chunks.push(bytes)
    }
  } catch (error) {
    if (error instanceof BackupCancelledError || error instanceof ManifestPayloadMismatchError) throw error
    throw new ManifestPayloadMismatchError(`packaged archive entry failed read-back: ${entry.path}`)
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
  if (sizeBytes !== entry.uncompressedSize) {
    throw new ManifestPayloadMismatchError(
      `packaged entry size ${sizeBytes} != catalog ${entry.uncompressedSize}: ${entry.path}`
    )
  }
  return { sizeBytes, ...(collect ? { bytes: Buffer.concat(chunks, sizeBytes) } : {}) }
}

function directoryChildren(
  payload: ResourcePayload,
  entries: readonly NormalizedEntry[]
): Array<{ readonly entry: NormalizedEntry; readonly relPath: string }> {
  const prefix = `${payload.archivePath}/`
  return entries
    .filter((entry) => entry.path.startsWith(prefix))
    .map((entry) => ({ entry, relPath: entry.path.slice(prefix.length) }))
    .filter(({ relPath }) => relPath.length > 0)
    .sort((left, right) => compareUtf8(left.relPath, right.relPath))
}

async function verifyDirectoryPayload(args: {
  readonly zip: Awaited<ReturnType<typeof openArchive>>['zip']
  readonly payload: ResourcePayload
  readonly resourceFiles: readonly NormalizedEntry[]
  readonly resourceDirs: readonly NormalizedEntry[]
  readonly processedFiles: Set<string>
  readonly signal?: AbortSignal
}): Promise<void> {
  const { zip, payload, resourceFiles, resourceDirs, processedFiles, signal } = args
  if (payload.resourceType !== 'directory') {
    throw new ManifestPayloadMismatchError(`directory payload has the wrong manifest shape: ${payload.livePath}`)
  }
  const dirs = directoryChildren(payload, resourceDirs)
  const files = directoryChildren(payload, resourceFiles)
  const hasRootDirectory = resourceDirs.some((entry) => entry.path === payload.archivePath)
  if (!hasRootDirectory && dirs.length === 0 && files.length === 0) {
    throw new ManifestPayloadMismatchError(`packaged directory payload is absent: ${payload.livePath}`)
  }

  const hash = createHash('sha256')
  for (const { relPath } of dirs) {
    throwIfAborted(signal)
    const pathBytes = Buffer.from(relPath, 'utf8')
    hash.update('D')
    hash.update(u64be(pathBytes.length))
    hash.update(pathBytes)
  }

  let sizeBytes = 0
  for (const { entry, relPath } of files) {
    throwIfAborted(signal)
    const pathBytes = Buffer.from(relPath, 'utf8')
    hash.update('F')
    hash.update(entry.executable ? 'X' : '-')
    hash.update(u64be(pathBytes.length))
    hash.update(pathBytes)
    hash.update(u64be(entry.uncompressedSize))
    const consumed = await consumeEntry({ zip, entry, signal, hash })
    sizeBytes += consumed.sizeBytes
    processedFiles.add(entry.path)
  }

  if (sizeBytes !== payload.sizeBytes || hash.digest('hex') !== payload.hash) {
    throw new ManifestPayloadMismatchError(`packaged directory payload does not match manifest: ${payload.livePath}`)
  }
}

async function verifyFilePayload(args: {
  readonly zip: Awaited<ReturnType<typeof openArchive>>['zip']
  readonly payload: ResourcePayload
  readonly resourceFiles: readonly NormalizedEntry[]
  readonly processedFiles: Set<string>
  readonly signal?: AbortSignal
}): Promise<void> {
  const { zip, payload, resourceFiles, processedFiles, signal } = args
  if (payload.resourceType !== 'file') {
    throw new ManifestPayloadMismatchError(`file payload has the wrong manifest shape: ${payload.livePath}`)
  }
  const entry = resourceFiles.find((candidate) => candidate.path === payload.archivePath)
  if (!entry) {
    throw new ManifestPayloadMismatchError(`packaged file payload is absent: ${payload.livePath}`)
  }
  if (entry.executable !== payload.executable || entry.uncompressedSize !== payload.sizeBytes) {
    throw new ManifestPayloadMismatchError(`packaged file metadata does not match manifest: ${payload.livePath}`)
  }
  const hash = createHash('sha256')
  const consumed = await consumeEntry({ zip, entry, signal, hash })
  if (consumed.sizeBytes !== payload.sizeBytes || hash.digest('hex') !== payload.hash) {
    throw new ManifestPayloadMismatchError(`packaged file payload does not match manifest: ${payload.livePath}`)
  }
  processedFiles.add(entry.path)
}

export async function verifyArchiveReadback(inputs: VerifyArchiveReadbackInputs): Promise<void> {
  const { archivePath, manifest, manifestBytes, ceilings, signal } = inputs
  throwIfAborted(signal)
  const open = await openArchive(archivePath)
  try {
    const shape = validateArchiveShape(open.entries, {
      ...ceilings,
      maxCompressionRatio: BACKUP_CEILINGS.maxCompressionRatio
    })
    classifyPayloadLayout(shape, manifest)

    const manifestReadback = await consumeEntry({
      zip: open.zip,
      entry: shape.manifest,
      signal,
      collect: true
    })
    if (!manifestReadback.bytes?.equals(manifestBytes)) {
      throw new ManifestPayloadMismatchError('packaged manifest bytes differ from the validated manifest')
    }

    if (shape.db.path !== DB_ENTRY || shape.db.uncompressedSize !== manifest.db.sizeBytes) {
      throw new ManifestPayloadMismatchError('packaged database metadata differs from the manifest')
    }
    const dbHash = createHash('sha256')
    await consumeEntry({ zip: open.zip, entry: shape.db, signal, hash: dbHash })
    if (dbHash.digest('hex') !== manifest.db.hash) {
      throw new ManifestPayloadMismatchError('packaged database bytes differ from the manifest')
    }

    const processedFiles = new Set<string>()
    for (const payload of manifest.resourcePayloads) {
      if (payload.resourceType === 'file') {
        await verifyFilePayload({
          zip: open.zip,
          payload,
          resourceFiles: shape.resourceFiles,
          processedFiles,
          signal
        })
      } else {
        await verifyDirectoryPayload({
          zip: open.zip,
          payload,
          resourceFiles: shape.resourceFiles,
          resourceDirs: shape.resourceDirs,
          processedFiles,
          signal
        })
      }
    }
    for (const entry of shape.resourceFiles) {
      if (!processedFiles.has(entry.path)) {
        throw new ManifestPayloadMismatchError(`packaged resource entry was not verified: ${entry.path}`)
      }
    }
  } finally {
    await open.close()
  }
}
