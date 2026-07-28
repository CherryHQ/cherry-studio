import { createWriteStream } from 'node:fs'
import { link, lstat, mkdtemp, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { finished } from 'node:stream/promises'

import { loggerService } from '@logger'
import { ZipArchive } from 'archiver'

import { archiveDurability } from './archiveDurability'
import { DB_ENTRY, MANIFEST_ENTRY } from './archiveLayout'
import { BACKUP_CEILINGS } from './ceilings'
import {
  BackupCancelledError,
  CeilingExceededError,
  DiskFullError,
  HardLinkUnsupportedError,
  ManifestPayloadMismatchError,
  OutputPathExistsError
} from './errors'
import { sha256FileCancellable } from './hashing'
import { type BackupManifest, parseBackupManifest } from './manifest'

const logger = loggerService.withContext('backup/archivePublish')

export interface ProducerCeilings {
  readonly maxArchiveEntries: number
  readonly maxEntryUncompressedBytes: number
  readonly maxTotalUncompressedBytes: number
  readonly maxManifestBytes: number
}

const DEFAULT_PRODUCER_CEILINGS: ProducerCeilings = Object.freeze({
  maxArchiveEntries: BACKUP_CEILINGS.maxArchiveEntries,
  maxEntryUncompressedBytes: BACKUP_CEILINGS.maxEntryUncompressedBytes,
  maxTotalUncompressedBytes: BACKUP_CEILINGS.maxTotalUncompressedBytes,
  maxManifestBytes: BACKUP_CEILINGS.maxManifestBytes
})

/** Test seam for the atomic no-clobber commit point. */
export const publishSeams = {
  hardLink(tmpPath: string, outPath: string): Promise<void> {
    return link(tmpPath, outPath)
  }
}

export interface PublishArchiveInputs {
  readonly outPath: string
  readonly manifest: BackupManifest
  readonly dbCopyPath: string
  readonly signal?: AbortSignal
}

export function publishArchive(inputs: PublishArchiveInputs): Promise<void> {
  return publishArchiveWithCeilings(inputs, DEFAULT_PRODUCER_CEILINGS)
}

/**
 * Publish exactly `manifest.json` and `backup.sqlite`. The payload is verified
 * before a temporary output exists; final visibility is one hard-link commit,
 * so an existing archive is never replaced and a partial archive is never named
 * at the user-selected destination.
 */
export async function publishArchiveWithCeilings(
  inputs: PublishArchiveInputs,
  ceilings: ProducerCeilings
): Promise<void> {
  const { outPath, manifest, dbCopyPath, signal } = inputs
  const parsed = parseBackupManifest(manifest)
  if (parsed.kind !== 'ok') throw new Error(`publishArchive: manifest failed strict validation: ${parsed.error}`)
  const validated = parsed.manifest

  if (ceilings.maxArchiveEntries < 2) {
    throw new CeilingExceededError('entries', 'two fixed archive entries exceed configured ceiling')
  }

  const dbStat = await lstat(dbCopyPath)
  if (!dbStat.isFile() || dbStat.isSymbolicLink()) {
    throw new ManifestPayloadMismatchError('dbCopyPath is not a regular file')
  }
  if (dbStat.size !== validated.db.sizeBytes) {
    throw new ManifestPayloadMismatchError(`db size ${dbStat.size} != manifest ${validated.db.sizeBytes}`)
  }
  if (dbStat.size > ceilings.maxEntryUncompressedBytes) {
    throw new CeilingExceededError('entry-bytes', `db is ${dbStat.size} > ${ceilings.maxEntryUncompressedBytes}`)
  }
  if ((await sha256FileCancellable(dbCopyPath, signal)) !== validated.db.hash) {
    throw new ManifestPayloadMismatchError('db sha256 != manifest')
  }

  const manifestBytes = Buffer.from(JSON.stringify(validated, null, 2), 'utf8')
  if (manifestBytes.byteLength > ceilings.maxManifestBytes) {
    throw new CeilingExceededError('manifest-bytes', `${manifestBytes.byteLength} > ${ceilings.maxManifestBytes}`)
  }
  if (BigInt(manifestBytes.byteLength) + BigInt(dbStat.size) > BigInt(ceilings.maxTotalUncompressedBytes)) {
    throw new CeilingExceededError('total-bytes', 'manifest + db exceed archive ceiling')
  }

  try {
    await stat(outPath)
    throw new OutputPathExistsError(outPath)
  } catch (error) {
    if (error instanceof OutputPathExistsError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (signal?.aborted) throw new BackupCancelledError()

  const tempDir = await mkdtemp(path.join(path.dirname(outPath), '.cherrybackup-tmp-'))
  const tmpFile = path.join(tempDir, 'archive.zip')
  try {
    const archive = new ZipArchive({ zlib: { level: 1 }, zip64: true })
    const output = createWriteStream(tmpFile, { flags: 'wx', mode: 0o600 })
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        archive.abort()
        reject(new BackupCancelledError())
      }
      const detach = (): void => signal?.removeEventListener('abort', onAbort)
      output.on('close', () => {
        detach()
        resolve()
      })
      output.on('error', (error) => {
        detach()
        reject(error)
      })
      archive.on('error', reject)
      archive.on('warning', (error: Error & { code?: string }) => {
        reject(new Error(`archiver warning (fatal for backup): ${error.code ?? ''} ${error.message}`))
      })
      signal?.addEventListener('abort', onAbort, { once: true })
      archive.pipe(output)
      archive.append(manifestBytes, { name: MANIFEST_ENTRY })
      archive.file(dbCopyPath, { name: DB_ENTRY })
      archive.finalize().catch(reject)
    }).catch(async (error) => {
      archive.abort()
      output.destroy()
      await finished(output).catch(() => {})
      throw error
    })

    await archiveDurability.fsyncFile(tmpFile)
    if (signal?.aborted) throw new BackupCancelledError()
    try {
      await publishSeams.hardLink(tmpFile, outPath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST') throw new OutputPathExistsError(outPath)
      if (code === 'ENOTSUP' || code === 'EOPNOTSUPP' || code === 'ENOSYS' || code === 'EPERM' || code === 'EXDEV') {
        throw new HardLinkUnsupportedError(outPath)
      }
      throw error
    }
    try {
      await archiveDurability.fsyncDir(path.dirname(outPath))
    } catch (error) {
      logger.warn('archive published but directory fsync failed', error as Error)
    }
  } catch (error) {
    throw (error as NodeJS.ErrnoException).code === 'ENOSPC' ? new DiskFullError() : error
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}
