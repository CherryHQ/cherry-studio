import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { loggerService } from '@logger'
import type { S3Config } from '@types'
import * as net from 'net'
import { Readable } from 'stream'

const logger = loggerService.withContext('S3Storage')

/**
 * 将可读流转换为 Buffer
 */
function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    stream.on('error', reject)
    stream.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

// 需要使用 Virtual Host-Style 的服务商域名后缀白名单
const VIRTUAL_HOST_SUFFIXES = ['aliyuncs.com', 'myqcloud.com']

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
      forcePathStyle: usePathStyle
    })

    this.bucket = bucket
    this.root = root?.replace(/^\/+/g, '').replace(/\/+$/g, '') || ''

    this.putFileContents = this.putFileContents.bind(this)
    this.getFileContents = this.getFileContents.bind(this)
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

  async putFileContents(key: string, data: Buffer | string) {
    try {
      const contentType = key.endsWith('.zip') ? 'application/zip' : 'application/octet-stream'

      return await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.buildKey(key),
          Body: data,
          ContentType: contentType
        })
      )
    } catch (error) {
      logger.error('[S3Storage] Error putting object:', error as Error)
      throw error
    }
  }

  async getFileContents(key: string): Promise<Buffer> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.buildKey(key) }))
      if (!res.Body || !(res.Body instanceof Readable)) {
        throw new Error('Empty body received from S3')
      }
      return await streamToBuffer(res.Body as Readable)
    } catch (error) {
      logger.error('[S3Storage] Error getting object:', error as Error)
      throw error
    }
  }

  async deleteFile(key: string) {
    try {
      const keyWithRoot = this.buildKey(key)
      const variations = new Set([keyWithRoot, key.replace(/^\//, '')])
      for (const k of variations) {
        try {
          await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: k }))
        } catch {
          // 忽略删除失败
        }
      }
    } catch (error) {
      logger.error('[S3Storage] Error deleting object:', error as Error)
      throw error
    }
  }

  /**
   * 列举指定前缀下的对象，默认列举全部。
   */
  async listFiles(prefix = ''): Promise<Array<{ key: string; lastModified?: string; size: number }>> {
    const files: Array<{ key: string; lastModified?: string; size: number }> = []
    let continuationToken: string | undefined
    const fullPrefix = this.buildKey(prefix)

    try {
      do {
        const res = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: fullPrefix === '' ? undefined : fullPrefix,
            ContinuationToken: continuationToken
          })
        )

        res.Contents?.forEach((obj) => {
          if (!obj.Key) return
          files.push({
            key: obj.Key,
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
