import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import fs from 'fs-extra'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }))

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(public input: unknown) {}
  }
  return {
    S3Client: class {
      send = sendMock
    },
    DeleteObjectCommand: Command,
    GetObjectCommand: Command,
    HeadBucketCommand: Command,
    ListObjectsV2Command: Command,
    PutObjectCommand: Command
  }
})

import { BackupCancelledError } from '../../errors'
import { createTransport } from '../destinationTransport'

describe('local destination transport', () => {
  let root: string
  let dir: string
  let archive: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cs-destination-transport-'))
    dir = path.join(root, 'backups')
    archive = path.join(root, 'staged.cherrybackup')
    await writeFile(archive, 'new bytes')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  const transport = () => createTransport({ kind: 'local', dir, maxBackups: 0 })

  it('replaces an archive of the same name only once the whole copy has landed', async () => {
    await fs.ensureDir(dir)
    await writeFile(path.join(dir, 'a.cherrybackup'), 'previous bytes')
    vi.spyOn(fs, 'copy').mockRejectedValueOnce(new Error('EIO: usb stick unplugged'))

    await expect(transport().upload(archive, 'a.cherrybackup')).rejects.toThrow('usb stick unplugged')

    expect(await readFile(path.join(dir, 'a.cherrybackup'), 'utf8')).toBe('previous bytes')
    expect(await readdir(dir)).toEqual(['a.cherrybackup'])
  })

  it('leaves no partial file behind once the archive is in place', async () => {
    await transport().upload(archive, 'a.cherrybackup')

    expect(await readdir(dir)).toEqual(['a.cherrybackup'])
    expect(await readFile(path.join(dir, 'a.cherrybackup'), 'utf8')).toBe('new bytes')
  })

  it('does not write anything for an upload that was already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(transport().upload(archive, 'a.cherrybackup', controller.signal)).rejects.toBeInstanceOf(
      BackupCancelledError
    )
    expect(await fs.pathExists(dir)).toBe(false)
  })

  // Cancelling a restore from a folder on a slow disk must not wait out the copy.
  it('reports a cancelled download as cancelled instead of finishing the copy', async () => {
    await transport().upload(archive, 'a.cherrybackup')
    const controller = new AbortController()
    controller.abort()

    await expect(
      transport().download('a.cherrybackup', path.join(root, 'downloaded'), controller.signal)
    ).rejects.toBeInstanceOf(BackupCancelledError)
  })
})

describe('S3 destination transport', () => {
  let root: string
  let archive: string

  beforeEach(async () => {
    sendMock.mockReset()
    root = await mkdtemp(path.join(tmpdir(), 'cs-s3-transport-'))
    archive = path.join(root, 'staged.cherrybackup')
    await writeFile(archive, 'new bytes')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const transport = () =>
    createTransport({
      kind: 's3',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      bucket: 'my-bucket',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
      root: 'backups',
      maxBackups: 0
    } as never)

  // Download and remove address a name directly under the root; a nested key
  // listed by its basename would point them at a different object.
  it('lists only archives directly under the root', async () => {
    sendMock.mockResolvedValueOnce({
      Contents: [
        { Key: 'backups/a.zip', Size: 1 },
        { Key: 'backups/laptop/b.zip', Size: 2 }
      ]
    })

    expect((await transport().list()).map((archive) => archive.name)).toEqual(['a.zip'])
  })

  // A cancelled upload must stop the request, not run out its retries first.
  it('aborts an upload in flight and reports it as cancelled', async () => {
    const controller = new AbortController()
    sendMock.mockImplementation((_command, options: { abortSignal?: AbortSignal }) => {
      controller.abort()
      return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError', seen: options.abortSignal }))
    })

    await expect(transport().upload(archive, 'a.zip', controller.signal)).rejects.toBeInstanceOf(BackupCancelledError)
    expect(sendMock).toHaveBeenCalledOnce()
    expect(sendMock.mock.calls[0][1]?.abortSignal).toBe(controller.signal)
  })
})
