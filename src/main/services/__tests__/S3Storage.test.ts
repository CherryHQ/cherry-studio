import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { describe, expect, it, vi } from 'vitest'

import type { S3Config } from '@shared/types/backup'

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
