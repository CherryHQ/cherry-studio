import { loggerService } from '@logger'
import https from 'https'
import path from 'path'
import type Stream from 'stream'
import type { BufferLike, CreateDirectoryOptions, PutFileContentsOptions, WebDAVClient } from 'webdav'
import { createClient } from 'webdav'

const logger = loggerService.withContext('WebDav')

/** What this client needs to reach a server. Resolved in main, never over IPC. */
export interface WebDavConfig {
  webdavHost: string
  webdavUser?: string
  webdavPass?: string
  webdavPath?: string
}

export default class WebDav {
  public instance: WebDAVClient | undefined
  private webdavPath: string

  constructor(params: WebDavConfig) {
    this.webdavPath = params.webdavPath || '/'

    this.instance = createClient(params.webdavHost, {
      username: params.webdavUser,
      password: params.webdavPass,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      httpsAgent: new https.Agent({
        rejectUnauthorized: false
      })
    })

    this.putFileContents = this.putFileContents.bind(this)
    this.createDirectory = this.createDirectory.bind(this)
    this.deleteFile = this.deleteFile.bind(this)
  }

  public putFileContents = async (
    filename: string,
    data: string | BufferLike | Stream.Readable,
    options?: PutFileContentsOptions
  ) => {
    if (!this.instance) {
      return new Error('WebDAV client not initialized')
    }

    try {
      if (!(await this.instance.exists(this.webdavPath))) {
        await this.instance.createDirectory(this.webdavPath, {
          recursive: true
        })
      }
    } catch (error) {
      logger.error('Error creating directory on WebDAV:', error as Error)
      throw error
    }

    const remoteFilePath = path.posix.join(this.webdavPath, filename)

    try {
      return await this.instance.putFileContents(remoteFilePath, data, options)
    } catch (error) {
      logger.error('Error putting file contents on WebDAV:', error as Error)
      throw error
    }
  }

  /**
   * Stream a remote file — a profile-sized archive must never have to fit in heap.
   */
  public createReadStream = (filename: string): Stream.Readable => {
    if (!this.instance) {
      throw new Error('WebDAV client not initialized')
    }
    return this.instance.createReadStream(path.posix.join(this.webdavPath, filename))
  }

  public getDirectoryContents = async () => {
    if (!this.instance) {
      throw new Error('WebDAV client not initialized')
    }

    try {
      return await this.instance.getDirectoryContents(this.webdavPath)
    } catch (error) {
      logger.error('Error getting directory contents on WebDAV:', error as Error)
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
      logger.error('Error checking connection:', error as Error)
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
      logger.error('Error creating directory on WebDAV:', error as Error)
      throw error
    }
  }

  public deleteFile = async (filename: string) => {
    if (!this.instance) {
      throw new Error('WebDAV client not initialized')
    }

    const remoteFilePath = path.posix.join(this.webdavPath, filename)

    try {
      return await this.instance.deleteFile(remoteFilePath)
    } catch (error) {
      logger.error('Error deleting file on WebDAV:', error as Error)
      throw error
    }
  }
}
