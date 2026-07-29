import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdtemp, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { atomicWriteFile, type PathIdentity, probePath, removeOwnedDirectory } from '@main/utils/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

const logger = loggerService.withContext('backup/exportOperation')
const STAGING_PREFIX = 'export-'
const PUBLISH_TEMP_PREFIX = '.cherrybackup-tmp-'
const STAGING_MARKER = '.backup-export-owner.json'
const PUBLISH_MARKER = '.backup-export-publish-owner.json'
const MARKER_VERSION = 1
const MAX_MARKER_BYTES = 16 * 1024

interface SerializedIdentity {
  readonly dev: string
  readonly ino: string
}

interface PublishTempRecord {
  readonly path: string
  readonly identity: SerializedIdentity
}

interface ExportMarker {
  readonly version: 1
  readonly operationId: string
  readonly outPath: string
  readonly stagingPath: string
  readonly stagingIdentity: SerializedIdentity
  readonly publishTemp?: PublishTempRecord
}

interface PublishMarker {
  readonly version: 1
  readonly operationId: string
  readonly stagingPath: string
  readonly identity: SerializedIdentity
}

export interface ExportOperationOwner {
  readonly operationId: string
  readonly stagingRoot: string
  readonly publishObserver: {
    onTempCreated(tempDir: string): Promise<void>
    onTempRemoved(tempDir: string): Promise<void>
  }
  /**
   * Remove the staging root when no destination-side cleanup debt remains.
   * Returns false when the owned marker must stay for a later startup sweep.
   */
  cleanup(): Promise<boolean>
}

function serializeIdentity(identity: PathIdentity): SerializedIdentity {
  return { dev: identity.dev.toString(), ino: identity.ino.toString() }
}

function parseIdentity(value: unknown): SerializedIdentity | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<SerializedIdentity>
  if (typeof candidate.dev !== 'string' || !/^\d+$/.test(candidate.dev)) return null
  if (typeof candidate.ino !== 'string' || !/^\d+$/.test(candidate.ino)) return null
  return { dev: candidate.dev, ino: candidate.ino }
}

function identitiesEqual(identity: PathIdentity, serialized: SerializedIdentity): boolean {
  return (
    identity.nodeType === 'directory' &&
    identity.dev.toString() === serialized.dev &&
    identity.ino.toString() === serialized.ino
  )
}

async function identityOf(directory: string): Promise<PathIdentity> {
  const probe = await probePath(directory)
  if (probe.kind !== 'present' || probe.identity.nodeType !== 'directory') {
    throw new Error(`backup-owned path is not a real directory: ${directory}`)
  }
  return probe.identity
}

async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  await atomicWriteFile(AbsoluteFilePathSchema.parse(target), `${JSON.stringify(value)}\n`, {
    mode: 0o600,
    directorySync: 'required'
  })
}

async function readJsonBounded(target: string): Promise<unknown> {
  const stats = await lstat(target)
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_MARKER_BYTES) {
    throw new Error('backup cleanup marker is not a bounded regular file')
  }
  return JSON.parse(await readFile(target, 'utf8')) as unknown
}

function parseExportMarker(value: unknown): ExportMarker | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ExportMarker>
  const stagingIdentity = parseIdentity(candidate.stagingIdentity)
  if (
    candidate.version !== MARKER_VERSION ||
    typeof candidate.operationId !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(candidate.operationId) ||
    typeof candidate.outPath !== 'string' ||
    !path.isAbsolute(candidate.outPath) ||
    typeof candidate.stagingPath !== 'string' ||
    !path.isAbsolute(candidate.stagingPath) ||
    !stagingIdentity
  ) {
    return null
  }
  let publishTemp: PublishTempRecord | undefined
  if (candidate.publishTemp !== undefined) {
    const publish = candidate.publishTemp as Partial<PublishTempRecord>
    const identity = parseIdentity(publish.identity)
    if (typeof publish.path !== 'string' || !path.isAbsolute(publish.path) || !identity) return null
    publishTemp = { path: publish.path, identity }
  }
  return {
    version: 1,
    operationId: candidate.operationId,
    outPath: candidate.outPath,
    stagingPath: candidate.stagingPath,
    stagingIdentity,
    ...(publishTemp ? { publishTemp } : {})
  }
}

function parsePublishMarker(value: unknown): PublishMarker | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<PublishMarker>
  const identity = parseIdentity(candidate.identity)
  if (
    candidate.version !== MARKER_VERSION ||
    typeof candidate.operationId !== 'string' ||
    typeof candidate.stagingPath !== 'string' ||
    !path.isAbsolute(candidate.stagingPath) ||
    !identity
  ) {
    return null
  }
  return {
    version: 1,
    operationId: candidate.operationId,
    stagingPath: candidate.stagingPath,
    identity
  }
}

async function safeRemoveOwnedDirectory(directory: string, identity: SerializedIdentity): Promise<void> {
  await removeOwnedDirectory(directory, {
    dev: BigInt(identity.dev),
    ino: BigInt(identity.ino),
    nodeType: 'directory'
  })
}

function validPublishTempPath(marker: ExportMarker): boolean {
  if (!marker.publishTemp) return true
  const tempDir = marker.publishTemp.path
  return (
    path.dirname(tempDir) === path.dirname(marker.outPath) && path.basename(tempDir).startsWith(PUBLISH_TEMP_PREFIX)
  )
}

async function removeRecordedPublishTemp(marker: ExportMarker): Promise<boolean> {
  if (!marker.publishTemp) return true
  if (!validPublishTempPath(marker)) return false
  const tempDir = marker.publishTemp.path
  const current = await probePath(tempDir)
  if (current.kind === 'missing') return true
  if (!identitiesEqual(current.identity, marker.publishTemp.identity)) {
    return false
  }
  let publishMarker: PublishMarker | null
  try {
    publishMarker = parsePublishMarker(await readJsonBounded(path.join(tempDir, PUBLISH_MARKER)))
  } catch {
    return false
  }
  if (
    !publishMarker ||
    publishMarker.operationId !== marker.operationId ||
    publishMarker.stagingPath !== marker.stagingPath ||
    !identitiesEqual(current.identity, publishMarker.identity)
  ) {
    return false
  }
  await removeOwnedDirectory(tempDir, current.identity)
  return true
}

/**
 * Recover the one handshake window where the destination marker is durable but
 * the staging marker update was interrupted. Both marker files still agree on
 * the random operation ID and staging path; the destination directory's own
 * marker also authenticates its current inode before deletion.
 */
async function removeDiscoverablePublishTemps(marker: ExportMarker): Promise<boolean> {
  if (marker.publishTemp) return removeRecordedPublishTemp(marker)

  const destinationParent = path.dirname(marker.outPath)
  let names: string[]
  try {
    names = await readdir(destinationParent)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
    throw error
  }

  for (const name of names) {
    if (!name.startsWith(PUBLISH_TEMP_PREFIX)) continue
    const candidatePath = path.join(destinationParent, name)
    const current = await probePath(candidatePath)
    if (current.kind === 'missing' || current.identity.nodeType !== 'directory') continue

    let publishMarker: PublishMarker | null
    try {
      publishMarker = parsePublishMarker(await readJsonBounded(path.join(candidatePath, PUBLISH_MARKER)))
    } catch {
      continue
    }
    if (
      !publishMarker ||
      publishMarker.operationId !== marker.operationId ||
      publishMarker.stagingPath !== marker.stagingPath
    ) {
      continue
    }
    if (!identitiesEqual(current.identity, publishMarker.identity)) return false
    await removeOwnedDirectory(candidatePath, current.identity)
  }
  return true
}

export async function createExportOperation(stagingParent: string, outPath: string): Promise<ExportOperationOwner> {
  const operationId = randomUUID()
  const stagingRoot = await mkdtemp(path.join(stagingParent, STAGING_PREFIX))
  let initializationIdentity: PathIdentity | undefined
  let marker: ExportMarker
  try {
    const beforeChmod = await identityOf(stagingRoot)
    initializationIdentity = beforeChmod
    await chmod(stagingRoot, 0o700)
    const stagingIdentity = await identityOf(stagingRoot)
    if (beforeChmod.dev !== stagingIdentity.dev || beforeChmod.ino !== stagingIdentity.ino) {
      throw new Error(`backup staging directory changed during initialization: ${stagingRoot}`)
    }
    marker = {
      version: 1,
      operationId,
      outPath: path.resolve(outPath),
      stagingPath: path.resolve(stagingRoot),
      stagingIdentity: serializeIdentity(stagingIdentity)
    }
    await writeJsonAtomic(path.join(stagingRoot, STAGING_MARKER), marker)
  } catch (error) {
    if (initializationIdentity) {
      await removeOwnedDirectory(stagingRoot, initializationIdentity).catch((cleanupError) => {
        logger.warn('Could not remove export staging after ownership-intent failure', cleanupError as Error, {
          operationId
        })
      })
    }
    throw error
  }

  const updateMarker = async (next: ExportMarker): Promise<void> => {
    await writeJsonAtomic(path.join(stagingRoot, STAGING_MARKER), next)
    marker = next
  }

  return {
    operationId,
    stagingRoot,
    publishObserver: {
      async onTempCreated(tempDir: string): Promise<void> {
        const resolved = path.resolve(tempDir)
        if (
          path.dirname(resolved) !== path.dirname(marker.outPath) ||
          !path.basename(resolved).startsWith(PUBLISH_TEMP_PREFIX)
        ) {
          throw new Error('backup publish temp is outside the destination directory')
        }
        const identity = await identityOf(resolved)
        const serialized = serializeIdentity(identity)
        await writeJsonAtomic(path.join(resolved, PUBLISH_MARKER), {
          version: 1,
          operationId,
          stagingPath: marker.stagingPath,
          identity: serialized
        } satisfies PublishMarker)
        await updateMarker({ ...marker, publishTemp: { path: resolved, identity: serialized } })
      },
      async onTempRemoved(tempDir: string): Promise<void> {
        if (marker.publishTemp?.path !== path.resolve(tempDir)) return
        const withoutPublishTemp: ExportMarker = {
          version: marker.version,
          operationId: marker.operationId,
          outPath: marker.outPath,
          stagingPath: marker.stagingPath,
          stagingIdentity: marker.stagingIdentity
        }
        await updateMarker(withoutPublishTemp)
      }
    },
    async cleanup(): Promise<boolean> {
      if (marker.publishTemp) return false
      try {
        await safeRemoveOwnedDirectory(stagingRoot, marker.stagingIdentity)
        return true
      } catch (error) {
        logger.warn('Could not remove export staging; startup cleanup will retry', error as Error, {
          operationId
        })
        return false
      }
    }
  }
}

/**
 * Remove only stale export roots whose own marker and any destination-side
 * marker agree. The published outPath is never opened, modified, or deleted.
 */
export async function sweepStaleExportOperations(stagingParent: string): Promise<number> {
  let names: string[]
  try {
    names = await readdir(stagingParent)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
  let removed = 0
  for (const name of names) {
    if (!name.startsWith(STAGING_PREFIX)) continue
    const stagingPath = path.join(stagingParent, name)
    let marker: ExportMarker | null
    try {
      marker = parseExportMarker(await readJsonBounded(path.join(stagingPath, STAGING_MARKER)))
    } catch {
      continue
    }
    if (!marker || marker.stagingPath !== path.resolve(stagingPath) || !validPublishTempPath(marker)) continue
    try {
      const current = await probePath(stagingPath)
      if (current.kind !== 'present' || !identitiesEqual(current.identity, marker.stagingIdentity)) {
        continue
      }
      if (!(await removeDiscoverablePublishTemps(marker))) continue
      await safeRemoveOwnedDirectory(stagingPath, marker.stagingIdentity)
      removed++
    } catch (error) {
      logger.warn('Could not sweep stale export operation', error as Error, {
        operationId: marker.operationId
      })
    }
  }
  return removed
}
