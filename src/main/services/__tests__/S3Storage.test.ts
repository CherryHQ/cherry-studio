import { DeleteObjectCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3'
import type { S3Config } from '@shared/types/backup'
import { describe, expect, it, vi } from 'vitest'

import S3Storage from '../S3Storage'

const config: S3Config = {
  endpoint: 'https://s3.example.com',
  region: 'us-east-1',
  bucket: 'backups',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  root: '/cherry-studio/test/',
  autoSync: false,
  syncInterval: 0,
  maxBackups: 0
}

describe('S3Storage', () => {
  it.each(['https://s3.cn-east-1.qiniucs.com', 'https://backups.s3.cn-east-1.qiniucs.com'])(
    'addresses a Qiniu bucket exactly once with endpoint %s',
    async (endpoint) => {
      const storage = new S3Storage({
        ...config,
        endpoint
      })
      const client = Reflect.get(storage, 'client') as S3Client
      const handle =
        vi.fn<
          (
            request: unknown
          ) => Promise<{ response: { statusCode: number; headers: Record<string, string>; body: string } }>
        >()
      handle.mockResolvedValue({ response: { statusCode: 200, headers: {}, body: '' } })
      Object.assign(client.config.requestHandler, { handle })

      await storage.checkConnection()

      expect(handle).toHaveBeenCalledOnce()
      expect(handle.mock.calls[0][0]).toMatchObject({
        hostname: 'backups.s3.cn-east-1.qiniucs.com',
        path: '/'
      })
    }
  )

  it('keeps Qiniu list and delete requests scoped to the configured root', async () => {
    const storage = new S3Storage({
      ...config,
      endpoint: 'https://backups.s3.cn-east-1.qiniucs.com'
    })
    const client = Reflect.get(storage, 'client') as S3Client
    const requests: Array<{ hostname: string; method: string; path: string; query?: Record<string, string> }> = []
    const listResponse = Buffer.from(`
      <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
        <Name>backups</Name>
        <Prefix>cherry-studio/test/</Prefix>
        <KeyCount>1</KeyCount>
        <MaxKeys>1000</MaxKeys>
        <IsTruncated>false</IsTruncated>
        <Contents>
          <Key>cherry-studio/test/backup.zip</Key>
          <LastModified>2026-09-07T00:00:00.000Z</LastModified>
          <Size>1</Size>
        </Contents>
      </ListBucketResult>
    `)
    const handle = vi.fn(async (request: (typeof requests)[number]) => {
      requests.push(request)
      return {
        response: {
          statusCode: 200,
          headers: { 'content-type': 'application/xml' },
          body: request.method === 'GET' ? listResponse : Buffer.from('')
        }
      }
    })
    Object.assign(client.config.requestHandler, { handle })

    const files = await storage.listFiles()
    await storage.deleteFile(files[0].key)

    expect(files).toEqual([{ key: 'backup.zip', lastModified: '2026-09-07T00:00:00.000Z', size: 1 }])
    expect(requests).toMatchObject([
      {
        hostname: 'backups.s3.cn-east-1.qiniucs.com',
        method: 'GET',
        path: '/',
        query: { prefix: 'cherry-studio/test/' }
      },
      {
        hostname: 'backups.s3.cn-east-1.qiniucs.com',
        method: 'DELETE',
        path: '/cherry-studio/test/backup.zip'
      }
    ])
  })

  it('lists object keys relative to the configured root', async () => {
    const storage = new S3Storage(config)
    const send = vi.fn().mockResolvedValue({
      Contents: [
        { Key: 'cherry-studio/test/backup.zip', Size: 1 },
        { Key: 'cherry-studio/test/nested/backup.zip', Size: 2 }
      ]
    })
    Object.assign(storage, { client: { send } })

    await expect(storage.listFiles()).resolves.toEqual([
      { key: 'backup.zip', lastModified: undefined, size: 1 },
      { key: 'nested/backup.zip', lastModified: undefined, size: 2 }
    ])

    expect(send.mock.calls[0][0]).toBeInstanceOf(ListObjectsV2Command)
    expect(send.mock.calls[0][0].input.Prefix).toBe('cherry-studio/test/')
  })

  it('only deletes the root-scoped key and propagates failures', async () => {
    const storage = new S3Storage(config)
    const error = new Error('Delete failed')
    const send = vi.fn().mockRejectedValue(error)
    Object.assign(storage, { client: { send } })

    await expect(storage.deleteFile('backup.zip')).rejects.toBe(error)

    expect(send).toHaveBeenCalledOnce()
    const command = send.mock.calls[0][0]
    expect(command).toBeInstanceOf(DeleteObjectCommand)
    expect(command.input).toEqual({ Bucket: 'backups', Key: 'cherry-studio/test/backup.zip' })
  })
})
