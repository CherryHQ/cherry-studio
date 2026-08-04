import type { S3Config } from '@shared/types/backup'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = sendMock
  },
  DeleteObjectCommand: class {
    constructor(public input: { Bucket: string; Key: string }) {}
  },
  GetObjectCommand: class {},
  HeadBucketCommand: class {},
  ListObjectsV2Command: class {},
  PutObjectCommand: class {}
}))

const { default: S3Storage } = await import('../S3Storage')

function storage(root: string) {
  return new S3Storage({
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    accessKeyId: 'id',
    secretAccessKey: 'secret',
    bucket: 'my-bucket',
    root
  } as S3Config)
}

describe('S3Storage.deleteFile', () => {
  beforeEach(() => {
    sendMock.mockReset()
    sendMock.mockResolvedValue({})
  })

  // The bucket root can hold objects this app never wrote; deleting a bare key
  // alongside the rooted one would take them out with the rotation.
  it('deletes only the object under the configured root', async () => {
    await storage('backups').deleteFile('cherry-studio.20260101.host.mac.zip')

    expect(sendMock).toHaveBeenCalledOnce()
    expect(sendMock.mock.calls[0][0].input).toEqual({
      Bucket: 'my-bucket',
      Key: 'backups/cherry-studio.20260101.host.mac.zip'
    })
  })

  it('leaves an already-rooted key alone', async () => {
    await storage('backups').deleteFile('backups/old.zip')

    expect(sendMock.mock.calls[0][0].input.Key).toBe('backups/old.zip')
  })

  // Rotation reads this result: a swallowed failure reports success, so old
  // backups pile up forever while the caller believes they were pruned.
  it('propagates a failed delete instead of reporting success', async () => {
    sendMock.mockRejectedValueOnce(new Error('AccessDenied'))

    await expect(storage('backups').deleteFile('old.zip')).rejects.toThrow('AccessDenied')
  })
})
