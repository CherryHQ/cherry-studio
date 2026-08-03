import { DeleteObjectCommand } from '@aws-sdk/client-s3'
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
