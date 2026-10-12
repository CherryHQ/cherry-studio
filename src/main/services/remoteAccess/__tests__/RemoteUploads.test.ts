import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { MockFileIntakeUtils } from '@test-mocks/main/FileIntakeService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'
import { BaseService } from '@main/core/lifecycle'
import { FileIntakeService, FileManager } from '@main/services/file'

import { RemoteUploads, type UploadOwner } from '../RemoteUploads'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

describe('durable remote uploads', () => {
  const db = setupTestDatabase()
  let root: string
  let intake: FileIntakeService
  let uploads: RemoteUploads
  let owner: UploadOwner
  const approve = (peerIdentity: string): UploadOwner => {
    const { device, authorization } = apiGatewayPairedDeviceService.approveRemote({
      name: peerIdentity,
      platform: 'ios',
      peerIdentity,
      capabilities: ['agent']
    })
    return { deviceId: device.id, grantId: authorization.grants[0].grantId, peerIdentity }
  }
  beforeEach(async () => {
    MockMainDbServiceUtils.setDb(db.db)
    root = await mkdtemp(path.join(tmpdir(), 'remote-upload-'))
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
      path.join(
        root,
        key === 'feature.files.intakes' ? 'intakes' : key === 'feature.files.data' ? 'files' : key,
        filename ?? ''
      )
    )
    await mkdir(path.join(root, 'files'))
    BaseService.resetInstances()
    intake = new FileIntakeService()
    MockFileIntakeUtils.setImplementation(intake)
    const files = new FileManager()
    Object.assign(application.get('FileManager'), { intakes: files.intakes })
    vi.mocked(application.get('FileManager').publishIntake).mockImplementation((input) => files.publishIntake(input))
    vi.mocked(application.get('FileManager').getById).mockImplementation((id) => files.getById(id))
    owner = approve('phone')
    uploads = new RemoteUploads()
  })
  afterEach(async () => {
    await intake.drain()
    await rm(root, { recursive: true, force: true })
    vi.restoreAllMocks()
  })
  const prepare = (bytes: Buffer) => {
    const metadata = {
      uploadId: randomUUID(),
      filename: '报告.txt',
      mediaType: 'text/plain',
      byteLength: bytes.length
    }
    return { metadata, started: uploads.prepare(owner, metadata) }
  }
  const write = (uploadId: string, bytes: Buffer, offset = 0, writerEpoch = '0') =>
    uploads.write(owner, {
      uploadId,
      writerEpoch,
      offset: String(offset),
      kind: 'upload',
      requestId: randomUUID(),
      bytes
    })
  it('recovers only the committed prefix after restart and fences the old writer', async () => {
    const bytes = Buffer.from('first second')
    const { metadata, started } = prepare(bytes)
    await started
    await write(metadata.uploadId, bytes.subarray(0, 6))
    const [directory] = await readdir(path.join(root, 'intakes'))
    await appendFile(path.join(root, 'intakes', directory, 'data', metadata.filename), 'uncommitted garbage')
    await intake.drain()
    BaseService.resetInstances()
    intake = new FileIntakeService()
    MockFileIntakeUtils.setImplementation(intake)
    uploads = new RemoteUploads()
    expect(await uploads.get(owner, metadata.uploadId)).toMatchObject({ committedOffset: '6' })
    const resume = { uploadId: metadata.uploadId, resumeId: randomUUID(), expectedWriterEpoch: '0' }
    expect(await uploads.resume(owner, resume)).toMatchObject({ writerEpoch: '1', committedOffset: '6' })
    expect(await uploads.resume(owner, resume)).toMatchObject({ writerEpoch: '1' })
    await expect(write(metadata.uploadId, bytes.subarray(6), 6)).rejects.toMatchObject({ data: { reason: 'CONFLICT' } })
    await write(metadata.uploadId, bytes.subarray(6), 6, '1')
    await uploads.complete(owner, { uploadId: metadata.uploadId, writerEpoch: '1' })
    await expect.poll(async () => (await uploads.get(owner, metadata.uploadId)).state).toBe('ready')
    expect((await readFile(path.join(root, 'intakes', directory, 'data', metadata.filename))).equals(bytes)).toBe(true)
  })
  it('resumes MiB binary blocks without a client hash and publishes the desktop digest', async () => {
    const bytes = Buffer.alloc(1024 * 1024 + 31, 73)
    const metadata = {
      uploadId: randomUUID(),
      filename: 'binary.bin',
      mediaType: 'application/octet-stream',
      byteLength: bytes.length
    }
    await uploads.prepare(owner, metadata)
    const chunk = {
      kind: 'upload' as const,
      requestId: 'block1',
      uploadId: metadata.uploadId,
      offset: '0',
      writerEpoch: '0',
      bytes: bytes.subarray(0, 1024 * 1024)
    }
    expect(await uploads.write(owner, chunk)).toMatchObject({ committedOffset: '1048576' })
    await expect(uploads.write(approve('stranger'), chunk)).rejects.toMatchObject({
      data: { reason: 'NOT_FOUND' }
    })
    await intake.drain()
    BaseService.resetInstances()
    intake = new FileIntakeService()
    MockFileIntakeUtils.setImplementation(intake)
    uploads = new RemoteUploads()
    expect(await uploads.get(owner, metadata.uploadId)).toMatchObject({ committedOffset: '1048576' })
    await uploads.resume(owner, { uploadId: metadata.uploadId, resumeId: randomUUID(), expectedWriterEpoch: '0' })
    await expect(uploads.write(owner, chunk)).rejects.toMatchObject({ data: { reason: 'CONFLICT' } })
    await uploads.write(owner, {
      ...chunk,
      requestId: 'block2',
      writerEpoch: '1',
      offset: '1048576',
      bytes: bytes.subarray(1024 * 1024)
    })
    await uploads.complete(owner, { uploadId: metadata.uploadId, writerEpoch: '1' })
    await expect.poll(async () => (await uploads.get(owner, metadata.uploadId)).state).toBe('ready')
    const [directory] = await readdir(path.join(root, 'intakes'))
    expect((await readFile(path.join(root, 'intakes', directory, 'data', metadata.filename))).equals(bytes)).toBe(true)
    expect(JSON.parse(await readFile(path.join(root, 'intakes', directory, 'state.json'), 'utf8')).sha256).toBe(
      digest(bytes)
    )
  })
  it('does not append duplicate chunks and rejects changed repeats, holes and overlapping chunks', async () => {
    const bytes = Buffer.from('abcdef')
    const { metadata, started } = prepare(bytes)
    await started
    await expect(write(metadata.uploadId, bytes.subarray(2), 2)).rejects.toMatchObject({ data: { reason: 'CONFLICT' } })
    await write(metadata.uploadId, bytes.subarray(0, 3))
    expect(await write(metadata.uploadId, bytes.subarray(0, 3))).toMatchObject({ committedOffset: '3' })
    await expect(write(metadata.uploadId, Buffer.from('xxx'))).rejects.toMatchObject({
      data: { reason: 'IDEMPOTENCY_CONFLICT' }
    })
    await expect(write(metadata.uploadId, bytes.subarray(2, 5), 2)).rejects.toMatchObject({
      data: { reason: 'CONFLICT' }
    })
    await expect(uploads.complete(owner, { uploadId: metadata.uploadId, writerEpoch: '0' })).rejects.toMatchObject({
      data: { reason: 'CONFLICT' }
    })
  })
  it('isolates devices and renewed grants and preserves cancellation across restart', async () => {
    const bytes = Buffer.from('secret')
    const { metadata, started } = prepare(bytes)
    await started
    await expect(uploads.get(approve('other'), metadata.uploadId)).rejects.toMatchObject({
      data: { reason: 'NOT_FOUND' }
    })
    await uploads.cancel(owner, metadata.uploadId)
    uploads = new RemoteUploads()
    await expect(uploads.prepare(owner, metadata)).rejects.toMatchObject({ data: { reason: 'NOT_FOUND' } })
    const next = prepare(bytes)
    await next.started
    approve('phone')
    await expect(uploads.get(owner, next.metadata.uploadId)).rejects.toMatchObject({
      data: { reason: 'GRANT_REVOKED' }
    })
  })
  it('reserves device capacity before receiving bytes and releases cancelled reservations', async () => {
    const metadata = {
      filename: 'reserved.bin',
      mediaType: 'application/octet-stream',
      byteLength: 1024 ** 3
    }
    const ids = Array.from({ length: 4 }, () => randomUUID())
    for (const uploadId of ids) await uploads.prepare(owner, { ...metadata, uploadId })
    const extra = { ...metadata, uploadId: randomUUID() }
    await expect(uploads.prepare(owner, extra)).rejects.toMatchObject({ data: { reason: 'RESOURCE_EXHAUSTED' } })
    await uploads.cancel(owner, ids[0])
    expect(await uploads.prepare(owner, extra)).toMatchObject({ committedOffset: '0', state: 'receiving' })
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 24 * 60 * 60 * 1000 + 1)
    await expect(uploads.get(owner, extra.uploadId)).rejects.toMatchObject({ data: { reason: 'NOT_FOUND' } })
  })

  it('streams a large attachment with bounded chunks and resumes midway', async () => {
    const size = Number(process.env.REMOTE_UPLOAD_TEST_BYTES ?? 3 * 1024 * 1024 + 17)
    const chunk = Buffer.alloc(1024 * 1024, 47)
    const metadata = {
      uploadId: randomUUID(),
      filename: 'large.bin',
      mediaType: 'application/octet-stream',
      byteLength: size
    }
    await uploads.prepare(owner, metadata)
    let offset = 0
    let epoch = '0'
    let restarted = false
    while (offset < size) {
      const writes: ReturnType<typeof write>[] = []
      for (let index = 0; index < 2 && offset < size; index++) {
        const bytes = chunk.subarray(0, Math.min(chunk.length, size - offset))
        writes.push(write(metadata.uploadId, bytes, offset, epoch))
        offset += bytes.length
      }
      const results = await Promise.all(writes)
      expect(results.at(-1)?.committedOffset).toBe(String(offset))
      if (!restarted && offset >= size / 2) {
        await intake.drain()
        BaseService.resetInstances()
        intake = new FileIntakeService()
        MockFileIntakeUtils.setImplementation(intake)
        uploads = new RemoteUploads()
        const recovered = await uploads.resume(owner, {
          uploadId: metadata.uploadId,
          expectedWriterEpoch: epoch,
          resumeId: randomUUID()
        })
        expect(recovered.committedOffset).toBe(String(offset))
        epoch = recovered.writerEpoch
        restarted = true
      }
    }
    await uploads.complete(owner, { uploadId: metadata.uploadId, writerEpoch: epoch })
    await expect.poll(async () => (await uploads.get(owner, metadata.uploadId)).state, { timeout: 30000 }).toBe('ready')
  }, 600000)

  it('accepts empty files and idempotent prepare, but never changes prepared metadata', async () => {
    const { metadata, started } = prepare(Buffer.alloc(0))
    const first = await started
    expect(await uploads.prepare(owner, metadata)).toEqual(first)
    await expect(uploads.prepare(owner, { ...metadata, filename: 'changed.txt' })).rejects.toMatchObject({
      data: { reason: 'IDEMPOTENCY_CONFLICT' }
    })
    await uploads.complete(owner, { uploadId: metadata.uploadId, writerEpoch: '0' })
    await expect.poll(async () => (await uploads.get(owner, metadata.uploadId)).state).toBe('ready')
  })
})
