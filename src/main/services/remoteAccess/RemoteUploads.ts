import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, rm, stat, truncate } from 'node:fs/promises'
import path from 'node:path'

import * as z from 'zod'

import { application } from '@application'
import {
  agentUploadLimits,
  uploadMetadataSchema,
  type AgentUploadMetadata,
  type AgentUploadReference,
  type AgentUploadResume,
  type AgentUploadState,
  type AgentUploadWrite
} from '@cherrystudio/remote-protocol/agent'
import { RemoteRpcError } from '@cherrystudio/remote-transport'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'
import { loggerService } from '@logger'
import type { CherryMessagePart } from '@shared/data/types/message'
import { withCherryMeta } from '@shared/data/types/uiParts'
import { AbsoluteFilePathSchema } from '@shared/types/file'

const logger = loggerService.withContext('RemoteUploads')
export type UploadOwner = { deviceId: string; grantId: string; peerIdentity: string }
const recordSchema = uploadMetadataSchema.extend({
  deviceId: z.string(),
  grantId: z.string(),
  peerIdentity: z.string(),
  offset: z.number().int().nonnegative(),
  epoch: z.number().int().nonnegative(),
  state: z.enum(['receiving', 'verifying', 'ready', 'failed', 'cancelled']),
  resumeId: z.string().optional(),
  createdAt: z.number(),
  expiresAt: z.number()
})
type Upload = z.infer<typeof recordSchema>
type PendingWrite = { input: AgentUploadWrite; resolve(value: AgentUploadState): void; reject(error: unknown): void }

/** Durable staging is independent of sockets; command receipts own message deduplication. */
export class RemoteUploads {
  private readonly uploads = new Map<string, Upload>()
  private readonly batches = new Map<
    string,
    { writes: PendingWrite[]; timer: ReturnType<typeof setTimeout>; flush(): void }
  >()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly verifying = new Map<string, Promise<void>>()
  private readonly pins = new Map<string, number>()
  private readonly work = new Set<Promise<unknown>>()
  private loading?: Promise<void>
  private stopped = false
  private sweeping = false

  private root(): string {
    return application.getPath('feature.remote_access.uploads')
  }
  private key(owner: UploadOwner, id: string): string {
    return createHash('sha256')
      .update(JSON.stringify([owner.deviceId, owner.grantId, id]))
      .digest('hex')
  }
  private directory(upload: Upload): string {
    return path.join(this.root(), this.key(upload, upload.uploadId))
  }
  private file(upload: Upload): string {
    return path.join(this.directory(upload), 'data', upload.filename)
  }
  private authorized(owner: UploadOwner): boolean {
    return Boolean(
      apiGatewayPairedDeviceService
        .getRemoteAuthorization(owner.deviceId, owner.peerIdentity)
        ?.grants.some((grant) => grant.domain === 'agent' && grant.grantId === owner.grantId)
    )
  }
  private check(owner: UploadOwner): void {
    if (this.stopped || !this.authorized(owner))
      throw new RemoteRpcError('GRANT_REVOKED', 'Upload authorization expired')
  }
  private async syncDirectory(directory: string): Promise<void> {
    if (process.platform === 'win32') return
    const handle = await open(directory, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }
  private async save(upload: Upload): Promise<void> {
    const directory = this.directory(upload)
    const temporary = path.join(directory, 'state.tmp')
    const handle = await open(temporary, 'w', 0o600)
    try {
      await handle.writeFile(JSON.stringify(upload))
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, path.join(directory, 'state.json'))
    this.uploads.set(this.key(upload, upload.uploadId), upload)
    await this.syncDirectory(directory)
  }
  private load(): Promise<void> {
    return (this.loading ??= (async () => {
      await mkdir(this.root(), { recursive: true })
      for (const key of await readdir(this.root())) {
        if (!/^[a-f0-9]{64}$/.test(key)) continue
        const directory = path.join(this.root(), key)
        try {
          const upload = recordSchema.parse(JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')))
          if (this.key(upload, upload.uploadId) !== key || upload.offset > upload.byteLength)
            throw new Error('Invalid upload record')
          if (upload.expiresAt <= Date.now() || !this.authorized(upload)) {
            await rm(directory, { recursive: true, force: true })
            continue
          }
          if (upload.state !== 'cancelled') {
            const size = (await stat(this.file(upload))).size
            if (size < upload.offset) upload.state = 'failed'
            else if (size > upload.offset) await truncate(this.file(upload), upload.offset)
          }
          this.uploads.set(key, upload)
        } catch (error) {
          logger.warn('Removing unrecoverable upload staging', { key, error })
          await rm(directory, { recursive: true, force: true })
        }
      }
    })())
  }
  private serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(key) ?? Promise.resolve()).then(async () => {
      await this.load()
      return work()
    })
    const settled = result.catch(() => undefined)
    this.queues.set(key, settled)
    void settled.then(() => {
      if (this.queues.get(key) === settled) this.queues.delete(key)
    })
    return result
  }
  private find(owner: UploadOwner, id: string): Upload {
    this.check(owner)
    const upload = this.uploads.get(this.key(owner, id))
    if (!upload || upload.state === 'cancelled' || upload.expiresAt <= Date.now())
      throw new RemoteRpcError('NOT_FOUND', 'Upload expired or not found')
    return upload
  }
  private state(upload: Upload): AgentUploadState {
    if (upload.state === 'cancelled') throw new RemoteRpcError('NOT_FOUND', 'Upload cancelled')
    return {
      uploadId: upload.uploadId,
      state: upload.state,
      committedOffset: String(upload.offset),
      writerEpoch: String(upload.epoch),
      expiresAt: new Date(upload.expiresAt).toISOString()
    }
  }
  private touch(upload: Upload): number {
    return Math.min(Date.now() + agentUploadLimits.retentionMs, upload.createdAt + agentUploadLimits.lifetimeMs)
  }
  prepare(owner: UploadOwner, input: AgentUploadMetadata): Promise<AgentUploadState> {
    return this.serial('prepare', () =>
      this.serial(this.key(owner, input.uploadId), async () => {
        this.check(owner)
        const previous = this.uploads.get(this.key(owner, input.uploadId))
        if (previous) {
          this.find(owner, input.uploadId)
          if (
            previous.filename !== input.filename ||
            previous.mediaType !== input.mediaType ||
            previous.byteLength !== input.byteLength ||
            previous.sha256 !== input.sha256
          )
            throw new RemoteRpcError('IDEMPOTENCY_CONFLICT', 'Upload metadata changed')
          return this.state(previous)
        }
        const active = [...this.uploads.values()].filter((upload) => upload.state !== 'cancelled')
        const total = active.reduce((size, upload) => size + upload.byteLength, input.byteLength)
        const device = active
          .filter((upload) => upload.deviceId === owner.deviceId)
          .reduce((size, upload) => size + upload.byteLength, input.byteLength)
        if (
          total > agentUploadLimits.stagingBytes ||
          device > agentUploadLimits.deviceBytes ||
          this.uploads.size >= 256
        )
          throw new RemoteRpcError('RESOURCE_EXHAUSTED', 'Upload staging capacity reached')
        const upload: Upload = {
          ...input,
          ...owner,
          offset: 0,
          epoch: 0,
          state: 'receiving',
          createdAt: Date.now(),
          expiresAt: Date.now() + agentUploadLimits.retentionMs
        }
        await mkdir(path.dirname(this.file(upload)), { recursive: true })
        const handle = await open(this.file(upload), 'wx', 0o600)
        await handle.sync()
        await handle.close()
        await this.syncDirectory(path.dirname(this.file(upload)))
        await this.save(upload)
        await this.syncDirectory(this.root())
        this.check(owner)
        return this.state(upload)
      })
    )
  }
  get(owner: UploadOwner, id: string): Promise<AgentUploadState> {
    return this.serial(this.key(owner, id), async () => {
      const upload = this.find(owner, id)
      if (upload.state === 'verifying') this.verify(upload)
      return this.state(upload)
    })
  }
  resume(owner: UploadOwner, input: AgentUploadResume): Promise<AgentUploadState> {
    return this.serial(this.key(owner, input.uploadId), async () => {
      const upload = this.find(owner, input.uploadId)
      if (upload.resumeId === input.resumeId) return this.state(upload)
      if (String(upload.epoch) !== input.expectedWriterEpoch)
        throw new RemoteRpcError('CONFLICT', 'Upload writer changed')
      const resumed = { ...upload, epoch: upload.epoch + 1, resumeId: input.resumeId }
      await this.save(resumed)
      return this.state(resumed)
    })
  }
  async write(owner: UploadOwner, input: AgentUploadWrite): Promise<AgentUploadState> {
    this.check(owner)
    const key = this.key(owner, input.uploadId)
    return new Promise((resolve, reject) => {
      let batch = this.batches.get(key)
      if (!batch) {
        const writes: PendingWrite[] = []
        const flush = () => {
          clearTimeout(batch!.timer)
          this.batches.delete(key)
          void this.writeBatch(
            owner,
            writes.map((entry) => entry.input)
          ).then(
            (state) => writes.forEach((entry) => entry.resolve(state)),
            (error) => writes.forEach((entry) => entry.reject(error))
          )
        }
        batch = { writes, timer: setTimeout(flush, 4), flush }
        this.batches.set(key, batch)
      }
      batch.writes.push({ input, resolve, reject })
      if (batch.writes.length >= agentUploadLimits.window) batch.flush()
    })
  }
  private writeBatch(owner: UploadOwner, inputs: AgentUploadWrite[]): Promise<AgentUploadState> {
    return this.serial(this.key(owner, inputs[0].uploadId), async () => {
      const upload = this.find(owner, inputs[0].uploadId)
      const handle = await open(this.file(upload), 'r+')
      let position = upload.offset
      try {
        await handle.truncate(upload.offset)
        for (const input of inputs) {
          if (String(upload.epoch) !== input.writerEpoch) throw new RemoteRpcError('CONFLICT', 'Upload writer changed')
          const offset = Number(input.offset)
          const bytes = Buffer.from(input.dataBase64, 'base64')
          if (
            !bytes.length ||
            bytes.length > agentUploadLimits.chunkBytes ||
            bytes.toString('base64') !== input.dataBase64 ||
            createHash('sha256').update(bytes).digest('hex') !== input.chunkSha256 ||
            !Number.isSafeInteger(offset) ||
            offset < 0 ||
            offset > position ||
            offset + bytes.length > upload.byteLength
          )
            throw new RemoteRpcError('CONFLICT', 'Invalid upload chunk or offset')
          if (offset < position) {
            if (offset + bytes.length > position) throw new RemoteRpcError('CONFLICT', 'Overlapping upload chunk')
            const stored = Buffer.alloc(bytes.length)
            const { bytesRead } = await handle.read(stored, 0, stored.length, offset)
            if (bytesRead !== bytes.length || !stored.equals(bytes))
              throw new RemoteRpcError('IDEMPOTENCY_CONFLICT', 'Upload chunk changed')
            continue
          }
          if (upload.state !== 'receiving') throw new RemoteRpcError('CONFLICT', 'Upload is not receiving')
          let written = 0
          while (written < bytes.length) {
            const result = await handle.write(bytes, written, bytes.length - written, offset + written)
            if (!result.bytesWritten) throw new Error('Upload write made no progress')
            written += result.bytesWritten
          }
          position += bytes.length
        }
        if (position === upload.offset) return this.state(upload)
        await handle.sync()
        const next = { ...upload, offset: position, expiresAt: this.touch(upload) }
        await this.save(next)
        this.check(owner)
        return this.state(next)
      } finally {
        await handle.close()
      }
    })
  }
  complete(owner: UploadOwner, input: { uploadId: string; writerEpoch: string }): Promise<AgentUploadState> {
    return this.serial(this.key(owner, input.uploadId), async () => {
      const upload = this.find(owner, input.uploadId)
      if (String(upload.epoch) !== input.writerEpoch) throw new RemoteRpcError('CONFLICT', 'Upload writer changed')
      if (upload.offset !== upload.byteLength) throw new RemoteRpcError('CONFLICT', 'Upload is incomplete')
      if (upload.state === 'receiving')
        await this.save({ ...upload, state: 'verifying', expiresAt: this.touch(upload) })
      const current = this.find(owner, input.uploadId)
      if (current.state === 'verifying') this.verify(current)
      return this.state(current)
    })
  }
  private verify(upload: Upload): void {
    const key = this.key(upload, upload.uploadId)
    if (this.verifying.has(key) || this.stopped) return
    const work = (async () => {
      const hash = createHash('sha256')
      for await (const bytes of createReadStream(this.file(upload))) {
        if (this.stopped) return
        hash.update(bytes)
      }
      const valid = hash.digest('hex') === upload.sha256
      await this.serial(key, async () => {
        const current = this.uploads.get(key)
        if (current?.state === 'verifying') await this.save({ ...current, state: valid ? 'ready' : 'failed' })
      })
    })()
      .catch(async (error) => {
        logger.warn('Upload verification failed', { key, error })
        await this.serial(key, async () => {
          const current = this.uploads.get(key)
          if (current?.state === 'verifying') await this.save({ ...current, state: 'failed' })
        }).catch((failure) => logger.warn('Upload failure persistence deferred', { key, failure }))
      })
      .finally(() => this.verifying.delete(key))
    this.verifying.set(key, work)
  }
  cancel(owner: UploadOwner, id: string) {
    return this.serial(this.key(owner, id), async () => {
      this.check(owner)
      const upload = this.uploads.get(this.key(owner, id))
      if (upload) {
        await this.save({ ...upload, state: 'cancelled' })
        if (!this.pins.has(this.key(owner, id)))
          await rm(path.dirname(this.file(upload)), { recursive: true, force: true })
      }
      return { cancelled: true as const }
    })
  }
  withFiles<T>(
    owner: UploadOwner,
    refs: AgentUploadReference[],
    run: (parts: CherryMessagePart[]) => Promise<T>
  ): Promise<T> {
    this.check(owner)
    const work = this.importFiles(owner, refs, run)
    this.work.add(work)
    void work.finally(() => this.work.delete(work)).catch(() => undefined)
    return work
  }
  private async importFiles<T>(
    owner: UploadOwner,
    refs: AgentUploadReference[],
    run: (parts: CherryMessagePart[]) => Promise<T>
  ): Promise<T> {
    const pinned: Upload[] = []
    try {
      for (const ref of refs)
        await this.serial(this.key(owner, ref.uploadId), async () => {
          const upload = this.find(owner, ref.uploadId)
          if (upload.state !== 'ready') throw new RemoteRpcError('CONFLICT', 'Attachment is not ready')
          const key = this.key(upload, upload.uploadId)
          this.pins.set(key, (this.pins.get(key) ?? 0) + 1)
          pinned.push(upload)
        })
      if (pinned.reduce((size, upload) => size + upload.byteLength, 0) > agentUploadLimits.messageBytes)
        throw new RemoteRpcError('RESOURCE_EXHAUSTED', 'Attachments exceed the message limit')
      const parts: CherryMessagePart[] = []
      for (const upload of pinned) {
        const manager = application.get('FileManager')
        const entry = await manager.createInternalEntry({
          source: 'path',
          path: AbsoluteFilePathSchema.parse(this.file(upload)),
          cleanupPolicy: 'delete_when_unreferenced'
        })
        parts.push(
          withCherryMeta(
            { type: 'file', mediaType: upload.mediaType, filename: upload.filename, url: manager.getUrl(entry.id) },
            { fileEntryId: entry.id, remoteAttachment: { sha256: upload.sha256, byteLength: upload.byteLength } }
          )
        )
      }
      this.check(owner)
      return await run(parts)
    } finally {
      for (const upload of pinned) {
        const key = this.key(upload, upload.uploadId)
        const remaining = (this.pins.get(key) ?? 1) - 1
        if (remaining) this.pins.set(key, remaining)
        else this.pins.delete(key)
      }
    }
  }
  sweep(): void {
    if (this.stopped || this.sweeping || !this.loading) return
    this.sweeping = true
    void this.load()
      .then(async () => {
        for (const [key] of this.uploads)
          await this.serial(key, async () => {
            const upload = this.uploads.get(key)
            if (!upload || this.pins.has(key) || this.verifying.has(key)) return
            if (upload.expiresAt <= Date.now() || !this.authorized(upload)) {
              await rm(this.directory(upload), { recursive: true, force: true })
              this.uploads.delete(key)
            } else if (upload.state === 'cancelled')
              await rm(path.dirname(this.file(upload)), { recursive: true, force: true })
          })
      })
      .catch((error) => logger.warn('Upload cleanup failed', error))
      .finally(() => {
        this.sweeping = false
      })
  }
  async dispose(): Promise<void> {
    this.stopped = true
    for (const batch of this.batches.values()) batch.flush()
    while (this.queues.size || this.verifying.size || this.work.size)
      await Promise.allSettled([...this.queues.values(), ...this.verifying.values(), ...this.work])
  }
}
