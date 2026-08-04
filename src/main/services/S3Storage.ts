import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { loggerService } from '@logger'
import type { S3Config } from '@shared/types/backup'
import * as net from 'net'
import { Readable } from 'stream'

const logger = loggerService.withContext('S3Storage')

// 需要使用 Virtual Host-Style 的服务商域名后缀白名单
const VIRTUAL_HOST_SUFFIXES = ['aliyuncs.com', 'myqcloud.com', 'volces.com']

interface S3UploadOptions {
  signal?: AbortSignal
  onProgress?: () => void
}

/**
 * 使用 AWS SDK v3 的简单 S3 封装，兼容之前 RemoteStorage 的最常用接口。
 */
export default class S3Storage {
  private client: S3Client
  private bucket: string
  private root: string

  constructor(config: S3Config) {
    const { endpoint, region, accessKeyId, secretAccessKey, bucket, root } = config

    const usePathStyle = (() => {
      if (!endpoint) return false

      try {
        const { hostname } = new URL(endpoint)

        if (hostname === 'localhost' || net.isIP(hostname) !== 0) {
          return true
        }

        const isInWhiteList = VIRTUAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
        return !isInWhiteList
      } catch (e) {
        logger.warn(`[S3Storage] Failed to parse endpoint, fallback to Path-Style: ${endpoint}`, e as Error)
        return true
      }
    })()

    this.client = new S3Client({
      region,
      endpoint: endpoint || undefined,
      credentials: {
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey
      },
      forcePathStyle: usePathStyle,
      // Avoid aws-chunked framing, which some S3-compatible providers reject for streamed PUTs.
      requestChecksumCalculation: 'WHEN_REQUIRED'
    })

    this.bucket = bucket
    this.root = root?.replace(/^\/+/g, '').replace(/\/+$/g, '') || ''

    this.putFileContents = this.putFileContents.bind(this)
    this.getFileStream = this.getFileStream.bind(this)
    this.deleteFile = this.deleteFile.bind(this)
    this.listFiles = this.listFiles.bind(this)
    this.checkConnection = this.checkConnection.bind(this)
  }

  /**
   * 内部辅助方法，用来拼接带 root 的对象 key
   */
  private buildKey(key: string): string {
    if (!this.root) return key
    return key.startsWith(`${this.root}/`) ? key : `${this.root}/${key}`
  }

  async putFileContents(
    key: string,
    data: Buffer | string | Readable,
    contentLength?: number,
    options: S3UploadOptions = {}
  ) {
    options.signal?.throwIfAborted()
    const abortController = new AbortController()
    const forwardAbort = () => abortController.abort(options.signal?.reason)

    options.signal?.addEventListener('abort', forwardAbort, { once: true })
    if (options.signal?.aborted) {
      forwardAbort()
    }

    try {
      const contentType = key.endsWith('.zip') ? 'application/zip' : 'application/octet-stream'
      const upload = new Upload({
        client: this.client,
        abortController,
        params: {
          Bucket: this.bucket,
          Key: this.buildKey(key),
          Body: data,
          ContentType: contentType,
          ContentLength: contentLength
        }
      })
      if (options.onProgress) upload.on('httpUploadProgress', options.onProgress)

      try {
        return await upload.done()
      } finally {
        if (options.onProgress) upload.off('httpUploadProgress', options.onProgress)
      }
    } catch (error) {
      logger.error('[S3Storage] Error putting object:', error as Error)
      throw error
    } finally {
      options.signal?.removeEventListener('abort', forwardAbort)
      if (data instanceof Readable && !data.destroyed) data.destroy()
    }
  }

  async getFileStream(key: string): Promise<Readable> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.buildKey(key) }))
      if (!res.Body || !(res.Body instanceof Readable)) {
        throw new Error('Empty body received from S3')
      }
      return res.Body
    } catch (error) {
      logger.error('[S3Storage] Error getting object:', error as Error)
      throw error
    }
  }

  async deleteFile(key: string, signal?: AbortSignal) {
    try {
      signal?.throwIfAborted()
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.buildKey(key) }), {
        abortSignal: signal
      })
    } catch (error) {
      logger.error('[S3Storage] Error deleting object:', error as Error)
      throw error
    }
  }

  /**
   * 列举指定前缀下的对象，默认列举全部。
   */
  async listFiles(
    prefix = '',
    signal?: AbortSignal
  ): Promise<Array<{ key: string; lastModified?: string; size: number }>> {
    const files: Array<{ key: string; lastModified?: string; size: number }> = []
    let continuationToken: string | undefined
    const fullPrefix = this.buildKey(prefix)

    try {
      do {
        signal?.throwIfAborted()
        const res = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: fullPrefix === '' ? undefined : fullPrefix,
            ContinuationToken: continuationToken
          }),
          { abortSignal: signal }
        )

        res.Contents?.forEach((obj) => {
          if (!obj.Key) return
          files.push({
            key: this.root ? obj.Key.slice(this.root.length + 1) : obj.Key,
            lastModified: obj.LastModified?.toISOString(),
            size: obj.Size ?? 0
          })
        })

        continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
      } while (continuationToken)

      return files
    } catch (error) {
      logger.error('[S3Storage] Error listing objects:', error as Error)
      throw error
    }
  }

  /**
   * 尝试调用 HeadBucket 判断凭证/网络是否可用
   */
  async checkConnection() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }))
      return true
    } catch (error) {
      logger.error('[S3Storage] Error checking connection:', error as Error)
      throw error
    }
  }
}
