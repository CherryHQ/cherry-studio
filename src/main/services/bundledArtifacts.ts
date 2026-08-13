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
  type BundledTreeArtifact
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

async function assertArchiveHash(filePath: string, expected: string): Promise<void> {
  const actual = await sha256File(filePath)
  if (actual !== expected) throw new Error(`Bundled archive checksum mismatch: expected ${expected}, got ${actual}`)
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
  await assertArchiveHash(archivePath, file.archiveSha256)
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  const temporaryPath = `${destination}.tmp-${process.pid}-${randomUUID()}`
  const hash = crypto.createHash('sha256')
  let size = 0

  try {
    await pipeline(
      fs.createReadStream(archivePath),
      createZstdDecompress(),
      hashingTransform(hash, (chunkSize) => {
        size += chunkSize
      }),
      fs.createWriteStream(temporaryPath)
    )
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

export async function isBundledTreeReady(artifact: BundledTreeArtifact, destination: string): Promise<boolean> {
  try {
    if ((await fsp.readFile(path.join(destination, TREE_MARKER_FILE), 'utf8')) !== treeMarker(artifact)) return false
    return artifact.entrypoints.every((entrypoint) => fs.existsSync(path.join(destination, entrypoint)))
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
  await assertArchiveHash(archivePath, artifact.archiveSha256)
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  const stagingPath = `${destination}.tmp-${process.pid}-${randomUUID()}`
  const hash = crypto.createHash('sha256')
  let size = 0

  try {
    await fsp.mkdir(stagingPath, { recursive: true })
    await pipeline(
      fs.createReadStream(archivePath),
      createZstdDecompress(),
      hashingTransform(hash, (chunkSize) => {
        size += chunkSize
      }),
      extract({ cwd: stagingPath, preservePaths: false, strict: true })
    )
    const actualHash = hash.digest('hex')
    if (size !== artifact.size || actualHash !== artifact.sha256) {
      throw new Error(
        `Bundled tree checksum mismatch: expected ${artifact.sha256}/${artifact.size}, got ${actualHash}/${size}`
      )
    }
    for (const entrypoint of artifact.entrypoints) {
      if (!fs.existsSync(path.join(stagingPath, entrypoint))) {
        throw new Error(`Bundled tree is missing entrypoint: ${entrypoint}`)
      }
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
