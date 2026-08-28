import { loggerService } from '@logger'
import type { WebDavConfig } from '@shared/types/backup'
import { redactSecretText } from '@shared/utils/redaction'
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

const logger = loggerService.withContext('WebDav')

/** Body-snippet cap for error logs; the body never enters the thrown message. */
const REMOTE_ERROR_BODY_SNIPPET_LIMIT = 500

/** A WebDAV failure prepared for rethrow, plus its log-only response body. */
interface DescribedWebDavError {
  error: unknown
  bodySnippet?: string
}

/**
 * Wrap status-bearing WebDAV failures with the renderer-matchable
 * `HTTP <code>` token, stage, and remote path; everything else passes through
 * untouched (the renderer matches TLS/timeout errors on raw message text).
 */
async function describeWebDavError(error: unknown, stage: string, remotePath: string): Promise<DescribedWebDavError> {
  if (!(error instanceof Error)) return { error }
  const { status } = error as { status?: unknown }
  if (typeof status !== 'number') return { error }
  const response = (error as { response?: { statusText?: string; text?: () => Promise<string> } }).response
  let bodySnippet: string | undefined
  try {
    // Redact before truncating so a secret split at the cap cannot leak a fragment.
    if (typeof response?.text === 'function') {
      bodySnippet = redactSecretText(await response.text()).slice(0, REMOTE_ERROR_BODY_SNIPPET_LIMIT)
    }
  } catch {
    // Best-effort diagnostics: a failed body read must not alter the error flow.
  }
  const statusText = response?.statusText || error.message.slice(0, 120)
  return {
    error: new Error(`${stage} ${remotePath} failed: HTTP ${status} (${statusText})`, { cause: error }),
    bodySnippet
  }
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
      const described = await describeWebDavError(error, 'WebDAV ensure directory', this.webdavPath)
      logger.error(
        'Error creating directory on WebDAV:',
        error as Error,
        described.bodySnippet ? { bodySnippet: described.bodySnippet } : {}
      )
      throw described.error
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
      const described = await describeWebDavError(error, 'WebDAV PUT', remoteFilePath)
      logger.error(
        'Error putting file contents on WebDAV:',
        error as Error,
        described.bodySnippet ? { bodySnippet: described.bodySnippet } : {}
      )
      throw described.error
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
      logger.error('Error getting file contents on WebDAV:', error as Error)
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
      logger.error('Error getting directory contents on WebDAV:', error as Error)
      throw error
    }
  }

  public checkConnection = async () => {
    if (!this.instance) {
      throw new Error('WebDAV client not initialized')
    }

    try {
      // Probe the configured backup path, not the server root: a green
      // result must mean the backup target is reachable (issue #10512).
      return await this.instance.exists(this.webdavPath)
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

  public deleteFile = async (filename: string, signal?: AbortSignal) => {
    if (!this.instance) {
      throw new Error('WebDAV client not initialized')
    }

    const remoteFilePath = path.posix.join(this.webdavPath, filename)

    try {
      return await this.instance.deleteFile(remoteFilePath, { signal })
    } catch (error) {
      logger.error('Error deleting file on WebDAV:', error as Error)
      throw error
    }
  }
}
