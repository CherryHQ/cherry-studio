import crypto, { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createZstdDecompress } from 'node:zlib'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import {
  bundledArtifactArchivePath,
  type BundledArtifactFile,
  type BundledArtifactManifest,
  type BundledFilesArtifact,
  type BundledTreeArtifact,
  type BundledTreeFile
} from '@main/utils/bundledArtifactManifest'
import lockfile from 'proper-lockfile'
import { extract } from 'tar'

const logger = loggerService.withContext('BundledArtifact')
const TREE_MARKER_FILE = '.artifact.json'
const LOCK_STALE_MS = 30_000
const LOCK_UPDATE_MS = 10_000

function hashingTransform(hash: crypto.Hash, onChunk?: (size: number) => void): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      onChunk?.(chunk.length)
      callback(null, chunk)
    }
  })
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  await pipeline(
    fs.createReadStream(filePath),
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        hash.update(chunk)
        callback()
      }
    })
  )
  return hash.digest('hex')
}

function assertArchiveHash(actual: string, expected: string): void {
  if (actual !== expected) throw new Error(`Bundled archive checksum mismatch: expected ${expected}, got ${actual}`)
}

function resolveArchivePath(manifest: BundledArtifactManifest, archive: string, archiveRoot?: string): string {
  const resolvedRoot = path.resolve(
    archiveRoot ??
      path.join(application.getPath('app.root.resources.binaries'), `${manifest.platform}-${manifest.arch}`)
  )
  const archivePath = path.resolve(bundledArtifactArchivePath(manifest, archive, resolvedRoot))
  const relative = path.relative(resolvedRoot, archivePath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Bundled archive escaped its source root: ${archive}`)
  }
  return archivePath
}

async function rethrowArchiveFailure(filePath: string, expected: string, error: unknown): Promise<never> {
  let actual: string
  try {
    actual = await sha256File(filePath)
  } catch {
    throw error
  }
  if (actual !== expected) {
    throw new Error(`Bundled archive checksum mismatch: expected ${expected}, got ${actual}`, { cause: error })
  }
  throw error
}

async function decompressAndVerifyArchive(
  archivePath: string,
  expected: { compression: 'none' | 'zstd'; archiveSha256: string; sha256: string; size: number },
  destination: NodeJS.WritableStream
): Promise<void> {
  const archiveHash = crypto.createHash('sha256')
  const contentHash = crypto.createHash('sha256')
  let contentSize = 0

  try {
    const source = fs.createReadStream(archivePath)
    if (expected.compression === 'none') {
      await pipeline(
        source,
        hashingTransform(archiveHash),
        hashingTransform(contentHash, (chunkSize) => {
          contentSize += chunkSize
        }),
        destination
      )
    } else {
      await pipeline(
        source,
        hashingTransform(archiveHash),
        createZstdDecompress(),
        hashingTransform(contentHash, (chunkSize) => {
          contentSize += chunkSize
        }),
        destination
      )
    }
  } catch (error) {
    await rethrowArchiveFailure(archivePath, expected.archiveSha256, error)
  }

  assertArchiveHash(archiveHash.digest('hex'), expected.archiveSha256)
  const actualHash = contentHash.digest('hex')
  if (contentSize !== expected.size || actualHash !== expected.sha256) {
    throw new Error(
      `Bundled payload checksum mismatch for ${archivePath}: expected ${expected.sha256}/${expected.size}, ` +
        `got ${actualHash}/${contentSize}`
    )
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.lstat(filePath)
    return true
  } catch {
    return false
  }
}

async function removeStalePath(filePath: string): Promise<void> {
  await fsp.rm(filePath, { recursive: true, force: true }).catch((error) => {
    logger.warn('Failed to clean a stale bundled artifact path', { path: filePath, error })
  })
}

async function recoverStaleBundledArtifactPaths(destination: string): Promise<void> {
  const directory = path.dirname(destination)
  const basename = path.basename(destination)
  let entries: fs.Dirent[]
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true })
  } catch {
    return
  }

  const temporaryPaths = entries
    .filter((entry) => entry.name.startsWith(`${basename}.tmp-`))
    .map((entry) => path.join(directory, entry.name))
  await Promise.all(temporaryPaths.map(removeStalePath))

  const backupPaths = entries
    .filter((entry) => entry.name.startsWith(`${basename}.old-`))
    .map((entry) => path.join(directory, entry.name))
  if (backupPaths.length === 0) return

  let destinationExists = await pathExists(destination)
  let restoredBackup: string | null = null
  if (!destinationExists) {
    const backupsByNewest = await Promise.all(
      backupPaths.map(async (backupPath) => ({
        backupPath,
        modifiedAt: await fsp
          .stat(backupPath)
          .then((stat) => stat.mtimeMs)
          .catch(() => 0)
      }))
    )
    backupsByNewest.sort((left, right) => right.modifiedAt - left.modifiedAt)
    for (const { backupPath } of backupsByNewest) {
      try {
        await fsp.rename(backupPath, destination)
        restoredBackup = backupPath
        destinationExists = true
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        logger.warn('Failed to recover a replaced bundled artifact', { path: backupPath, destination, error })
        return
      }
    }
  }

  if (destinationExists) {
    await Promise.all(backupPaths.filter((backupPath) => backupPath !== restoredBackup).map(removeStalePath))
  }
}

async function recoverStaleBundledArtifactGroup(destinationDirectory: string): Promise<void> {
  const parent = path.dirname(destinationDirectory)
  const basename = path.basename(destinationDirectory)
  let entries: fs.Dirent[]
  try {
    entries = await fsp.readdir(parent, { withFileTypes: true })
  } catch {
    return
  }
  await Promise.all(
    entries
      .filter((entry) => entry.name.startsWith(`${basename}.tmp-`))
      .map((entry) => removeStalePath(path.join(parent, entry.name)))
  )
}

async function withBundledArtifactLock<T>(destination: string, task: () => Promise<T>): Promise<T> {
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  const release = await lockfile.lock(destination, {
    realpath: false,
    stale: LOCK_STALE_MS,
    update: LOCK_UPDATE_MS,
    retries: { retries: 60, factor: 1.2, minTimeout: 100, maxTimeout: 1_000, randomize: true }
  })
  try {
    await recoverStaleBundledArtifactPaths(destination)
    return await task()
  } finally {
    await release()
  }
}

async function replacePath(
  stagingPath: string,
  destination: string,
  verifyPublished: () => Promise<boolean>
): Promise<void> {
  const backupPath = `${destination}.old-${process.pid}-${randomUUID()}`
  let backupExists = false
  let published = false
  let verified = false
  try {
    try {
      await fsp.rename(destination, backupPath)
      backupExists = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    await fsp.rename(stagingPath, destination)
    published = true

    if (!(await verifyPublished())) {
      throw new Error(`Bundled artifact failed post-install verification: ${destination}`)
    }
    verified = true
  } catch (error) {
    if (published) {
      await fsp.rm(destination, { recursive: true, force: true }).catch((rollbackError) => {
        throw new AggregateError([error, rollbackError], `Failed to roll back bundled artifact: ${destination}`)
      })
    }
    if (backupExists) {
      await fsp.rename(backupPath, destination).catch((rollbackError) => {
        throw new AggregateError([error, rollbackError], `Failed to restore bundled artifact: ${destination}`)
      })
      backupExists = false
    }
    throw error
  } finally {
    if (verified && backupExists) {
      await fsp.rm(backupPath, { recursive: true, force: true }).catch((error) => {
        logger.warn('Failed to clean replaced bundled artifact', { path: backupPath, error })
      })
    }
  }
}

async function isBundledFileReady(file: BundledArtifactFile, destination: string): Promise<boolean> {
  try {
    const stat = await fsp.stat(destination)
    if (!stat.isFile() || stat.size !== file.size) return false
    if (!isWin && (stat.mode & 0o777) !== file.mode) return false
    return (await sha256File(destination)) === file.sha256
  } catch {
    return false
  }
}

async function materializeBundledFileContents(
  manifest: BundledArtifactManifest,
  file: BundledArtifactFile,
  destination: string,
  archiveRoot?: string
): Promise<void> {
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  await decompressAndVerifyArchive(
    resolveArchivePath(manifest, file.archive, archiveRoot),
    file,
    fs.createWriteStream(destination)
  )
  if (!isWin) await fsp.chmod(destination, file.mode)
  if (!(await isBundledFileReady(file, destination))) {
    throw new Error(`Bundled file failed staging verification: ${destination}`)
  }
}

async function replaceBundledFileGroup(
  stagingDirectory: string,
  manifestFiles: readonly BundledArtifactFile[],
  destinationDirectory: string
): Promise<void> {
  const backups = new Map<string, string>()
  const published: string[] = []
  try {
    for (const file of manifestFiles) {
      const destination = path.join(destinationDirectory, file.output)
      const backup = `${destination}.old-${process.pid}-${randomUUID()}`
      try {
        await fsp.rename(destination, backup)
        backups.set(destination, backup)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }

    for (const file of manifestFiles) {
      const staged = path.join(stagingDirectory, file.output)
      const destination = path.join(destinationDirectory, file.output)
      await fsp.mkdir(path.dirname(destination), { recursive: true })
      await fsp.rename(staged, destination)
      published.push(destination)
    }

    for (const file of manifestFiles) {
      const destination = path.join(destinationDirectory, file.output)
      if (!(await isBundledFileReady(file, destination))) {
        throw new Error(`Bundled file failed post-install verification: ${destination}`)
      }
    }

    await Promise.all(
      [...backups.values()].map((backup) =>
        fsp.rm(backup, { force: true }).catch((error) => {
          logger.warn('Failed to clean replaced bundled file', { path: backup, error })
        })
      )
    )
    backups.clear()
  } catch (error) {
    await Promise.all(published.map((destination) => fsp.rm(destination, { force: true })))
    for (const [destination, backup] of backups) {
      await fsp.rename(backup, destination).catch((rollbackError) => {
        logger.error('Failed to restore bundled file after group rollback', rollbackError as Error, {
          destination,
          backup
        })
      })
    }
    throw error
  } finally {
    await fsp.rm(stagingDirectory, { recursive: true, force: true })
  }
}

function treeMarker(artifact: BundledTreeArtifact): string {
  return `${JSON.stringify({ version: artifact.version, sha256: artifact.sha256 })}\n`
}

async function collectTreeFiles(root: string, current: string, result: Map<string, fs.Stats>): Promise<void> {
  for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
    if (current === root && entry.name === TREE_MARKER_FILE) continue
    const absolutePath = path.join(current, entry.name)
    const stat = await fsp.lstat(absolutePath)
    if (stat.isDirectory()) {
      await collectTreeFiles(root, absolutePath, result)
      continue
    }
    if (!stat.isFile()) throw new Error(`Unsupported bundled tree entry: ${absolutePath}`)
    result.set(path.relative(root, absolutePath).split(path.sep).join('/'), stat)
  }
}

async function isBundledTreeContentReady(files: readonly BundledTreeFile[], destination: string): Promise<boolean> {
  try {
    const installedFiles = new Map<string, fs.Stats>()
    await collectTreeFiles(destination, destination, installedFiles)
    if (installedFiles.size !== files.length) return false
    for (const file of files) {
      const stat = installedFiles.get(file.path)
      if (!stat || stat.size !== file.size || (!isWin && (stat.mode & 0o777) !== file.mode)) return false
      if ((await sha256File(path.join(destination, file.path))) !== file.sha256) return false
    }
    return true
  } catch {
    return false
  }
}

async function isBundledTreeReady(artifact: BundledTreeArtifact, destination: string): Promise<boolean> {
  try {
    if ((await fsp.readFile(path.join(destination, TREE_MARKER_FILE), 'utf8')) !== treeMarker(artifact)) return false
    return isBundledTreeContentReady(artifact.files, destination)
  } catch {
    return false
  }
}

async function materializeBundledTree(
  manifest: BundledArtifactManifest,
  artifact: BundledTreeArtifact,
  destination: string,
  archiveRoot?: string
): Promise<void> {
  const archivePath = resolveArchivePath(manifest, artifact.archive, archiveRoot)
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  const stagingPath = `${destination}.tmp-${process.pid}-${randomUUID()}`

  try {
    await fsp.mkdir(stagingPath, { recursive: true })
    await decompressAndVerifyArchive(
      archivePath,
      artifact,
      extract({ cwd: stagingPath, preservePaths: false, strict: true })
    )
    if (!(await isBundledTreeContentReady(artifact.files, stagingPath))) {
      throw new Error('Bundled tree does not match its declared file inventory')
    }
    await fsp.writeFile(path.join(stagingPath, TREE_MARKER_FILE), treeMarker(artifact), 'utf8')
    await replacePath(stagingPath, destination, () => isBundledTreeReady(artifact, destination))
  } finally {
    await fsp.rm(stagingPath, { recursive: true, force: true })
  }
}

type BundledArtifactStatus = 'ready' | 'installed'

async function ensureBundledDestination(
  destination: string,
  isReady: () => Promise<boolean>,
  install: () => Promise<void>
): Promise<BundledArtifactStatus> {
  return withBundledArtifactLock(destination, async () => {
    if (await isReady()) return 'ready'
    await install()
    return 'installed'
  })
}

export async function ensureBundledFiles(
  manifest: BundledArtifactManifest,
  artifact: BundledFilesArtifact,
  destinationDirectory: string,
  options: { archiveRoot?: string } = {}
): Promise<{ status: BundledArtifactStatus; paths: ReadonlyMap<string, string> }> {
  const paths = new Map<string, string>()
  for (const file of artifact.files) paths.set(file.output, path.join(destinationDirectory, file.output))

  return withBundledArtifactLock(destinationDirectory, async () => {
    await recoverStaleBundledArtifactGroup(destinationDirectory)
    await Promise.all(
      artifact.files.map((file) => recoverStaleBundledArtifactPaths(path.join(destinationDirectory, file.output)))
    )
    if (
      await Promise.all(
        artifact.files.map(async (file) => isBundledFileReady(file, path.join(destinationDirectory, file.output)))
      ).then((ready) => ready.every(Boolean))
    ) {
      return { status: 'ready' as const, paths }
    }

    const stagingDirectory = `${destinationDirectory}.tmp-${process.pid}-${randomUUID()}`
    try {
      await fsp.mkdir(stagingDirectory, { recursive: true })
      for (const file of artifact.files) {
        await materializeBundledFileContents(
          manifest,
          file,
          path.join(stagingDirectory, file.output),
          options.archiveRoot
        )
      }
      await replaceBundledFileGroup(stagingDirectory, artifact.files, destinationDirectory)
      return { status: 'installed' as const, paths }
    } finally {
      await fsp.rm(stagingDirectory, { recursive: true, force: true })
    }
  })
}

export async function ensureBundledTree(
  manifest: BundledArtifactManifest,
  artifact: BundledTreeArtifact,
  destination: string,
  options: { archiveRoot?: string } = {}
): Promise<{ status: BundledArtifactStatus; root: string }> {
  const status = await ensureBundledDestination(
    destination,
    () => isBundledTreeReady(artifact, destination),
    () => materializeBundledTree(manifest, artifact, destination, options.archiveRoot)
  )
  return { status, root: destination }
}

export async function cleanupOtherArtifactVersions(root: string, currentVersion: string): Promise<void> {
  let entries: fs.Dirent[]
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === currentVersion) continue
    try {
      await fsp.rm(path.join(root, entry.name), { recursive: true, force: true })
    } catch (error) {
      logger.warn('Failed to clean an old bundled artifact version', { path: path.join(root, entry.name), error })
    }
  }
}
