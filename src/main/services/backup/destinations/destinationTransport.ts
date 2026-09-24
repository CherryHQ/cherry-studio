import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import fs from 'fs-extra'

import { loggerService } from '@logger'
import S3Storage from '@main/services/S3Storage'
import WebDav from '@main/services/WebDav'

import { BackupCancelledError } from '../errors'
import type { ResolvedDestination } from './destinationConfig'

const logger = loggerService.withContext('BackupDestinationTransport')

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new BackupCancelledError('backup upload cancelled')
}

/** One archive sitting at a destination, as the rotation and the picker see it. */
export interface RemoteArchive {
  readonly name: string
  /** Epoch millis. Rotation sorts on this, so it must be comparable across destinations. */
  readonly modifiedAt: number
  readonly size: number
}

/**
 * What every backup destination can do. Deliberately four operations and no
 * more: anything richer would be a storage abstraction, and this only ever
 * moves whole archives.
 *
 * Uploads and downloads stream. An archive is the entire user profile — reading
 * one into a Buffer to hand to a client is how a 5 GB backup becomes an
 * out-of-memory crash on the machine that could least afford to lose it.
 */
export interface DestinationTransport {
  upload(localPath: string, name: string, signal?: AbortSignal): Promise<void>
  download(name: string, destPath: string): Promise<void>
  list(): Promise<RemoteArchive[]>
  remove(name: string): Promise<void>
  check(): Promise<boolean>
}

function webdavTransport(destination: Extract<ResolvedDestination, { kind: 'webdav' }>): DestinationTransport {
  const client = new WebDav({
    webdavHost: destination.host,
    webdavUser: destination.user,
    webdavPass: destination.pass,
    webdavPath: destination.path
  })

  return {
    async upload(localPath, name, signal) {
      throwIfCancelled(signal)
      if (destination.disableStream) {
        await client.putFileContents(name, await fs.readFile(localPath), { overwrite: true })
      } else {
        // `contentLength` is required with a stream body: without it the client
        // falls back to chunked encoding, which a number of WebDAV servers reject.
        const { size } = await fs.stat(localPath)
        await client.putFileContents(name, fs.createReadStream(localPath), { overwrite: true, contentLength: size })
      }
      // The client cannot be aborted mid-transfer; at least never report a cancelled upload as done.
      throwIfCancelled(signal)
    },

    async download(name, destPath) {
      await pipeline(client.createReadStream(name), fs.createWriteStream(destPath))
    },

    async list() {
      const entries = await client.getDirectoryContents()
      return entries
        .filter((entry) => entry.type === 'file')
        .map((entry) => ({
          name: entry.basename,
          modifiedAt: new Date(entry.lastmod).getTime(),
          size: entry.size
        }))
    },

    async remove(name) {
      await client.deleteFile(name)
    },

    async check() {
      return (await client.checkConnection()) === true
    }
  }
}

function s3Transport(destination: Extract<ResolvedDestination, { kind: 's3' }>): DestinationTransport {
  const client = new S3Storage({
    endpoint: destination.endpoint,
    region: destination.region,
    bucket: destination.bucket,
    accessKeyId: destination.accessKeyId,
    secretAccessKey: destination.secretAccessKey,
    root: destination.root
  })

  return {
    async upload(localPath, name, signal) {
      throwIfCancelled(signal)
      try {
        await client.putFile(name, localPath, signal)
      } catch (error) {
        // The SDK's abort error, reported as the cancellation it is.
        throwIfCancelled(signal)
        throw error
      }
      throwIfCancelled(signal)
    },

    async download(name, destPath) {
      await client.downloadToFile(name, destPath)
    },

    async list() {
      const objects = await client.listFiles()
      // Only objects directly under the root: download and remove address a
      // name there, so a nested key would resolve to a different object.
      return objects
        .filter((object) => !object.key.includes('/'))
        .map((object) => ({
          name: object.key,
          modifiedAt: object.lastModified ? new Date(object.lastModified).getTime() : 0,
          size: object.size
        }))
    },

    async remove(name) {
      await client.deleteFile(name)
    },

    async check() {
      return client.checkConnection()
    }
  }
}

function localTransport(destination: Extract<ResolvedDestination, { kind: 'local' }>): DestinationTransport {
  const target = (name: string) => path.join(destination.dir, name)

  return {
    async upload(localPath, name, signal) {
      throwIfCancelled(signal)
      await fs.ensureDir(destination.dir)
      // Copy beside the target and rename over it: a copy that fails part-way
      // (NAS, USB stick) must never leave the previous archive of that name truncated.
      const partial = target(`.${name}.partial-${randomUUID()}`)
      try {
        await fs.copy(localPath, partial)
        throwIfCancelled(signal)
        await fs.rename(partial, target(name))
      } catch (error) {
        await fs.remove(partial).catch(() => {})
        throw error
      }
    },

    async download(name, destPath) {
      await fs.copy(target(name), destPath)
    },

    async list() {
      if (!(await fs.pathExists(destination.dir))) return []
      const names = await fs.readdir(destination.dir)
      const entries = await Promise.all(
        names.map(async (name) => {
          const stats = await fs.stat(target(name)).catch(() => null)
          if (!stats?.isFile()) return null
          return { name, modifiedAt: stats.mtimeMs, size: stats.size }
        })
      )
      return entries.filter((entry): entry is RemoteArchive => entry !== null)
    },

    async remove(name) {
      await fs.remove(target(name))
    },

    async check() {
      try {
        await fs.ensureDir(destination.dir)
        return true
      } catch (error) {
        logger.warn('Local backup directory is not usable', error as Error)
        return false
      }
    }
  }
}

export function createTransport(destination: ResolvedDestination): DestinationTransport {
  if (destination.kind === 'webdav') return webdavTransport(destination)
  if (destination.kind === 's3') return s3Transport(destination)
  return localTransport(destination)
}
