import https from 'https'
import path from 'path'
import type Stream from 'stream'

import type {
  BufferLike,
  CreateDirectoryOptions,
  CreateReadStreamOptions,
  GetFileContentsOptions,
  PutFileContentsOptions,
  WebDAVClient
} from 'webdav'
import { createClient } from 'webdav'

import { loggerService } from '@logger'
import { logFailure } from '@main/core/logger/logFailure'
import { classifyStorageFailure } from '@main/services/remoteStorage/failureFacts'
import { BACKUP_WEBDAV_TOO_LARGE_ERROR_CODE, type WebDavConfig } from '@shared/types/backup'
import { markReportingHandled } from '@shared/utils/errorReporting'

const logger = loggerService.withContext('WebDav')

export default class WebDav {
  public instance: WebDAVClient | undefined
  private webdavPath: string

  constructor(params: WebDavConfig) {
    this.webdavPath = params.webdavPath || '/'

    // Fail-closed: TLS certificates are verified unless the user explicitly opts in.
    // The agent only serves https:// requests — plain-http hosts are unaffected.
    this.instance = createClient(params.webdavHost, {
      username: params.webdavUser,
      password: params.webdavPass,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      // Opt-in skips ALL certificate checks (expired/hostname too) — Node agents
      // cannot selectively allow self-signed certs; copy must state the full scope.
      ...(params.allowSelfSignedTls === true ? { httpsAgent: new https.Agent({ rejectUnauthorized: false }) } : {})
    })

    this.putFileContents = this.putFileContents.bind(this)
    this.getFileContents = this.getFileContents.bind(this)
    this.createReadStream = this.createReadStream.bind(this)
    this.createDirectory = this.createDirectory.bind(this)
    this.deleteFile = this.deleteFile.bind(this)
  }

  public putFileContents = async (
    filename: string,
    data: string | BufferLike | Stream.Readable,
    options?: PutFileContentsOptions
  ) => {
    if (!this.instance) {
      throw new Error('WebDAV client not initialized')
    }

    try {
      if (!(await this.instance.exists(this.webdavPath, { signal: options?.signal }))) {
        await this.instance.createDirectory(this.webdavPath, {
          recursive: true,
          signal: options?.signal
        })
      }
    } catch (error) {
      logFailure(logger, 'Error creating directory on WebDAV:', error, 'storage.webdav', classifyStorageFailure(error))
      throw error
    }

    const remoteFilePath = path.posix.join(this.webdavPath, filename)
    // webdav 5.x ignores contentLength for streams, but still honors per-request headers.
    const requestOptions =
      typeof options?.contentLength === 'number'
        ? {
            ...options,
            headers: { ...options.headers, 'Content-Length': String(options.contentLength) }
          }
        : options

    try {
      return await this.instance.putFileContents(remoteFilePath, data, requestOptions)
    } catch (error) {
      logFailure(
        logger,
        'Error putting file contents on WebDAV:',
        error,
        'storage.webdav',
        classifyStorageFailure(error)
      )
      if (typeof error === 'object' && error !== null && 'status' in error && error.status === 413) {
        const reported = new Error(`${BACKUP_WEBDAV_TOO_LARGE_ERROR_CODE}: HTTP 413`, { cause: error })
        markReportingHandled(reported)
        throw reported
      }
      throw error
    }
  }

  public getFileContents = async (filename: string, options?: GetFileContentsOptions) => {
    if (!this.instance) {
      throw new Error('WebDAV client not initialized')
    }

    const remoteFilePath = path.posix.join(this.webdavPath, filename)

    try {
      return await this.instance.getFileContents(remoteFilePath, options)
    } catch (error) {
      logFailure(
        logger,
        'Error getting file contents on WebDAV:',
        error,
        'storage.webdav',
        classifyStorageFailure(error)
      )
      throw error
    }
  }

  public createReadStream = (filename: string, options?: CreateReadStreamOptions) => {
    if (!this.instance) {
      throw new Error('WebDAV client not initialized')
    }

    return this.instance.createReadStream(path.posix.join(this.webdavPath, filename), options)
  }

  public getDirectoryContents = async (signal?: AbortSignal) => {
    if (!this.instance) {
      throw new Error('WebDAV client not initialized')
    }

    try {
      return await this.instance.getDirectoryContents(this.webdavPath, { signal })
    } catch (error) {
      logFailure(
        logger,
        'Error getting directory contents on WebDAV:',
        error,
        'storage.webdav',
        classifyStorageFailure(error)
      )
      throw error
    }
  }

  public checkConnection = async () => {
    if (!this.instance) {
      throw new Error('WebDAV client not initialized')
    }

    try {
      return await this.instance.exists('/')
    } catch (error) {
      logFailure(logger, 'Error checking connection:', error, 'storage.webdav', classifyStorageFailure(error))
      throw error
    }
  }

  public createDirectory = async (path: string, options?: CreateDirectoryOptions) => {
    if (!this.instance) {
      throw new Error('WebDAV client not initialized')
    }

    try {
      return await this.instance.createDirectory(path, options)
    } catch (error) {
      logFailure(logger, 'Error creating directory on WebDAV:', error, 'storage.webdav', classifyStorageFailure(error))
      throw error
    }
  }

  public deleteFile = async (filename: string, signal?: AbortSignal) => {
    if (!this.instance) {
      throw new Error('WebDAV client not initialized')
    }

    const remoteFilePath = path.posix.join(this.webdavPath, filename)

    try {
      return await this.instance.deleteFile(remoteFilePath, { signal })
    } catch (error) {
      logFailure(logger, 'Error deleting file on WebDAV:', error, 'storage.webdav', classifyStorageFailure(error))
      throw error
    }
  }
}
