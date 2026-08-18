import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { loggerService } from '@logger'
import fs from 'fs-extra'
import * as net from 'net'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

const logger = loggerService.withContext('S3Storage')
const S3_SOCKET_IDLE_TIMEOUT_MS = 5 * 60_000

/** S3 caps a single PutObject at 5 GiB; multipart is a separate feature. */
const SINGLE_PUT_MAX_BYTES = 5 * 1024 * 1024 * 1024
const PUT_MAX_ATTEMPTS = 3

// 需要使用 Virtual Host-Style 的服务商域名后缀白名单
const VIRTUAL_HOST_SUFFIXES = ['aliyuncs.com', 'myqcloud.com', 'volces.com']

/** What this storage client needs; scheduling and rotation belong elsewhere. */
export interface S3StorageConfig {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  root?: string
}

export default class S3Storage {
  private client: S3Client
  private bucket: string
  private root: string

  constructor(config: S3StorageConfig) {
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
      requestHandler: { socketTimeout: S3_SOCKET_IDLE_TIMEOUT_MS },
      // Default `WHEN_SUPPORTED` sends a streamed body as `aws-chunked` with a
      // trailing checksum, which several S3-compatible endpoints reject outright.
      // Those endpoints are most of this feature's users.
      requestChecksumCalculation: 'WHEN_REQUIRED'
    })

    this.bucket = bucket
    this.root = root?.replace(/^\/+/g, '').replace(/\/+$/g, '') || ''

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

  async deleteFile(key: string, signal?: AbortSignal) {
    try {
      signal?.throwIfAborted()
      // Delete only under the configured root; a bare key could hit an unrelated bucket-root object.
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.buildKey(key) }), {
        abortSignal: signal
      })
    } catch (error) {
      logger.error('[S3Storage] Error deleting object:', error as Error)
      throw error
    }
  }

  /**
   * Upload a file by streaming it, so archive size never becomes heap size.
   *
   * `ContentLength` is read up front because a stream body has no length of its
   * own, and a PutObject without one is rejected by most S3 implementations.
   *
   * Retries recreate the stream. A `Readable` is consumed once, so the SDK's own
   * retry would replay an exhausted body and silently write a truncated object —
   * which is why the retry lives here instead.
   */
  async putFile(key: string, filePath: string): Promise<void> {
    const { size } = await fs.stat(filePath)
    if (size > SINGLE_PUT_MAX_BYTES) {
      throw new Error(`backup archive is ${size} bytes; a single S3 upload cannot exceed ${SINGLE_PUT_MAX_BYTES}`)
    }
    const contentType = key.endsWith('.zip') ? 'application/zip' : 'application/octet-stream'

    let lastError: unknown
    for (let attempt = 1; attempt <= PUT_MAX_ATTEMPTS; attempt++) {
      try {
        await this.client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: this.buildKey(key),
            Body: fs.createReadStream(filePath),
            ContentLength: size,
            ContentType: contentType
          })
        )
        return
      } catch (error) {
        lastError = error
        logger.warn(`[S3Storage] Upload attempt ${attempt}/${PUT_MAX_ATTEMPTS} failed`, error as Error)
      }
    }
    logger.error('[S3Storage] Error putting object:', lastError as Error)
    throw lastError
  }

  /**
   * Download an object straight to disk. Same reason as {@link putFile}: a
   * profile-sized archive must never be materialized in memory.
   */
  async downloadToFile(key: string, destPath: string): Promise<void> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.buildKey(key) }))
      if (!res.Body || !(res.Body instanceof Readable)) {
        throw new Error('Empty body received from S3')
      }
      await pipeline(res.Body, fs.createWriteStream(destPath))
    } catch (error) {
      logger.error('[S3Storage] Error downloading object:', error as Error)
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
