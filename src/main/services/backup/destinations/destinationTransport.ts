import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import { loggerService } from '@logger'
import S3Storage from '@main/services/S3Storage'
import WebDav from '@main/services/WebDav'
import fs from 'fs-extra'

import type { ResolvedDestination } from './destinationConfig'

const logger = loggerService.withContext('BackupDestinationTransport')

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
  upload(localPath: string, name: string): Promise<void>
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
    async upload(localPath, name) {
      if (destination.disableStream) {
        await client.putFileContents(name, await fs.readFile(localPath), { overwrite: true })
        return
      }
      // `contentLength` is required with a stream body: without it the client
      // falls back to chunked encoding, which a number of WebDAV servers reject.
      const { size } = await fs.stat(localPath)
      await client.putFileContents(name, fs.createReadStream(localPath), { overwrite: true, contentLength: size })
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
    async upload(localPath, name) {
      await client.putFile(name, localPath)
    },

    async download(name, destPath) {
      await client.downloadToFile(name, destPath)
    },

    async list() {
      const objects = await client.listFiles()
      return objects.map((object) => ({
        name: path.posix.basename(object.key),
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
    async upload(localPath, name) {
      await fs.ensureDir(destination.dir)
      // `move` across volumes copies then unlinks, which is what a backup folder
      // on a NAS or a USB stick needs — the export itself stays on a local disk.
      await fs.move(localPath, target(name), { overwrite: true })
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
