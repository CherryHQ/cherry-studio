import crypto, { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createZstdDecompress } from 'node:zlib'

import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import {
  bundledArtifactArchivePath,
  type BundledArtifactFile,
  type BundledArtifactManifest,
  type BundledTreeArtifact,
  type BundledTreeFile
} from '@main/utils/bundledArtifactManifest'
import { extract } from 'tar'

const logger = loggerService.withContext('BundledArtifacts')
const TREE_MARKER_FILE = '.artifact.json'

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

export async function recoverStaleBundledArtifactPaths(destination: string): Promise<void> {
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

async function replacePath(stagingPath: string, destination: string): Promise<void> {
  const backupPath = `${destination}.old-${process.pid}-${randomUUID()}`
  let backupExists = false
  let published = false
  try {
    try {
      await fsp.rename(destination, backupPath)
      backupExists = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    try {
      await fsp.rename(stagingPath, destination)
      published = true
    } catch (error) {
      if (backupExists) {
        await fsp.rename(backupPath, destination)
        backupExists = false
      }
      throw error
    }
  } finally {
    if (published && backupExists) {
      await fsp.rm(backupPath, { recursive: true, force: true }).catch((error) => {
        logger.warn('Failed to clean replaced bundled artifact', { path: backupPath, error })
      })
    }
  }
}

export async function isBundledFileReady(
  file: BundledArtifactFile,
  destination: string,
  verifyHash = false
): Promise<boolean> {
  try {
    const stat = await fsp.stat(destination)
    if (!stat.isFile() || stat.size !== file.size) return false
    if (!isWin && (stat.mode & 0o777) !== file.mode) return false
    return !verifyHash || (await sha256File(destination)) === file.sha256
  } catch {
    return false
  }
}

export async function materializeBundledFile(
  manifest: BundledArtifactManifest,
  file: BundledArtifactFile,
  destination: string
): Promise<void> {
  const archivePath = bundledArtifactArchivePath(manifest, file.archive)
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  const temporaryPath = `${destination}.tmp-${process.pid}-${randomUUID()}`
  const archiveHash = crypto.createHash('sha256')
  const hash = crypto.createHash('sha256')
  let size = 0

  try {
    try {
      await pipeline(
        fs.createReadStream(archivePath),
        hashingTransform(archiveHash),
        createZstdDecompress(),
        hashingTransform(hash, (chunkSize) => {
          size += chunkSize
        }),
        fs.createWriteStream(temporaryPath)
      )
    } catch (error) {
      await rethrowArchiveFailure(archivePath, file.archiveSha256, error)
    }
    assertArchiveHash(archiveHash.digest('hex'), file.archiveSha256)
    const actualHash = hash.digest('hex')
    if (size !== file.size || actualHash !== file.sha256) {
      throw new Error(
        `Bundled file checksum mismatch for ${file.output}: expected ${file.sha256}/${file.size}, ` +
          `got ${actualHash}/${size}`
      )
    }
    if (!isWin) await fsp.chmod(temporaryPath, file.mode)
    await replacePath(temporaryPath, destination)
  } finally {
    await fsp.rm(temporaryPath, { force: true })
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

export async function isBundledTreeReady(artifact: BundledTreeArtifact, destination: string): Promise<boolean> {
  try {
    if ((await fsp.readFile(path.join(destination, TREE_MARKER_FILE), 'utf8')) !== treeMarker(artifact)) return false
    return isBundledTreeContentReady(artifact.files, destination)
  } catch {
    return false
  }
}

export async function materializeBundledTree(
  manifest: BundledArtifactManifest,
  artifact: BundledTreeArtifact,
  destination: string
): Promise<void> {
  const archivePath = bundledArtifactArchivePath(manifest, artifact.archive)
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  const stagingPath = `${destination}.tmp-${process.pid}-${randomUUID()}`
  const archiveHash = crypto.createHash('sha256')
  const hash = crypto.createHash('sha256')
  let size = 0

  try {
    await fsp.mkdir(stagingPath, { recursive: true })
    try {
      await pipeline(
        fs.createReadStream(archivePath),
        hashingTransform(archiveHash),
        createZstdDecompress(),
        hashingTransform(hash, (chunkSize) => {
          size += chunkSize
        }),
        extract({ cwd: stagingPath, preservePaths: false, strict: true })
      )
    } catch (error) {
      await rethrowArchiveFailure(archivePath, artifact.archiveSha256, error)
    }
    assertArchiveHash(archiveHash.digest('hex'), artifact.archiveSha256)
    const actualHash = hash.digest('hex')
    if (size !== artifact.size || actualHash !== artifact.sha256) {
      throw new Error(
        `Bundled tree checksum mismatch: expected ${artifact.sha256}/${artifact.size}, got ${actualHash}/${size}`
      )
    }
    if (!(await isBundledTreeContentReady(artifact.files, stagingPath))) {
      throw new Error('Bundled tree does not match its signed file inventory')
    }
    await fsp.writeFile(path.join(stagingPath, TREE_MARKER_FILE), treeMarker(artifact), 'utf8')
    await replacePath(stagingPath, destination)
  } finally {
    await fsp.rm(stagingPath, { recursive: true, force: true })
  }
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
