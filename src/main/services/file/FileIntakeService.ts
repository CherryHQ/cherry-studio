import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rm, stat, truncate } from 'node:fs/promises'
import path from 'node:path'

import { Semaphore } from 'async-mutex'
import { v7 as uuidv7 } from 'uuid'

import { application } from '@application'
import { hasPendingRestore } from '@data/db/restore/restoreJournal'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase, Emitter } from '@main/core/lifecycle'
import { FileEntryIdSchema } from '@shared/data/types/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import {
  fileIntakeLimits,
  type FileIntakeMetadata,
  type FileIntakeSnapshot,
  type FileIntakeWrite,
  type FileIntakeResume
} from './intakeTypes'
import { metadataSchema, type Upload } from './internal/IntakeStore'

const logger = loggerService.withContext('FileIntakeService')
export type FileIntakeOwner = { ownerId: string; quotaKey: string }
export type FileIntakeEntry = {
  entryId: string
  filename: string
  mediaType: string
  sha256: string
  byteLength: number
}
export class FileIntakeError extends Error {
  constructor(
    readonly code: 'CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'NOT_FOUND' | 'RESOURCE_EXHAUSTED' | 'UNAVAILABLE',
    message: string
  ) {
    super(message)
  }
}
/** Durable staging is independent of sockets; command receipts own message deduplication. */
@Injectable('FileIntakeService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['FileManager'])
export class FileIntakeService extends BaseService {
  private readonly changes = new Emitter<{ ownerId: string; uploadId: string }>()
  readonly onChanged = this.changes.event
  protected async onInit(): Promise<void> {
    this.registerDisposable(this.changes)
    await this.load()
    for (const upload of this.uploads.values()) if (upload.state === 'verifying') this.verify(upload)
    this.registerInterval(() => this.sweep(), 1000)
  }
  protected async onStop(): Promise<void> {
    await this.drain()
  }

  private get store() {
    return application.get('FileManager').intakes
  }
  private get uploads() {
    return this.store.uploads
  }
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly verifying = new Map<string, Promise<void>>()
  private readonly verificationSlots = new Semaphore(2)
  private get pins() {
    return this.store.pins
  }
  private readonly work = new Set<Promise<unknown>>()
  private loading?: Promise<void>
  private stopped = false
  private sweeping = false

  private root(): string {
    return this.store.root()
  }
  private key(owner: FileIntakeOwner, id: string): string {
    return this.store.key(owner, id)
  }
  private directory(upload: Upload): string {
    return this.store.directory(upload)
  }
  private file(upload: Upload): string {
    return this.store.file(upload)
  }
  private check(): void {
    if (this.stopped) throw new FileIntakeError('UNAVAILABLE', 'File intake service stopped')
  }
  async cancelOwner(owner: FileIntakeOwner): Promise<void> {
    await this.load()
    for (const upload of this.uploads.values())
      if (upload.ownerId === owner.ownerId) await this.cancel(owner, upload.uploadId)
  }
  private syncDirectory(directory: string): Promise<void> {
    return this.store.syncDirectory(directory)
  }
  private async save(upload: Upload): Promise<void> {
    await this.store.save(upload)
    this.changes.fire({ ownerId: upload.ownerId, uploadId: upload.uploadId })
  }
  async owners(): Promise<FileIntakeOwner[]> {
    await this.load()
    return [
      ...new Map([...this.uploads.values()].map(({ ownerId, quotaKey }) => [ownerId, { ownerId, quotaKey }])).values()
    ]
  }
  private load(): Promise<void> {
    return (this.loading ??= (async () => {
      await this.store.load()
      for (const upload of this.uploads.values()) {
        if (upload.state === 'cancelled' || upload.state === 'ready') continue
        try {
          const size = (await stat(this.file(upload))).size
          if (size < upload.offset) await this.save({ ...upload, state: 'failed' })
          else if (size > upload.offset) await truncate(this.file(upload), upload.offset)
        } catch (error) {
          logger.warn('Intake source unavailable', { uploadId: upload.uploadId, error })
          if (!upload.entryId) await this.save({ ...upload, state: 'failed' })
        }
      }
    })())
  }
  private serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(key) ?? Promise.resolve()).then(async () => {
      if (hasPendingRestore()) throw new FileIntakeError('UNAVAILABLE', 'File intake paused during restore')
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
  private find(owner: FileIntakeOwner, id: string): Upload {
    this.check()
    const upload = this.uploads.get(this.key(owner, id))
    if (!upload || upload.state === 'cancelled' || upload.expiresAt <= Date.now())
      throw new FileIntakeError('NOT_FOUND', 'Upload expired or not found')
    return upload
  }
  private snapshot(upload: Upload): FileIntakeSnapshot {
    if (upload.state === 'cancelled') throw new FileIntakeError('NOT_FOUND', 'Upload cancelled')
    return {
      uploadId: upload.uploadId,
      state: upload.state,
      committedOffset: String(upload.offset),
      writerEpoch: String(upload.epoch),
      expiresAt: new Date(upload.expiresAt).toISOString()
    }
  }
  private touch(upload: Upload): number {
    return Math.min(Date.now() + fileIntakeLimits.retentionMs, upload.createdAt + fileIntakeLimits.lifetimeMs)
  }
  prepare(owner: FileIntakeOwner, input: FileIntakeMetadata): Promise<FileIntakeSnapshot> {
    metadataSchema.parse(input)
    return this.serial('prepare', () =>
      this.serial(this.key(owner, input.uploadId), async () => {
        this.check()
        const previous = this.uploads.get(this.key(owner, input.uploadId))
        if (previous) {
          this.find(owner, input.uploadId)
          if (
            previous.filename !== input.filename ||
            previous.mediaType !== input.mediaType ||
            previous.byteLength !== input.byteLength
          )
            throw new FileIntakeError('IDEMPOTENCY_CONFLICT', 'Upload metadata changed')
          return this.snapshot(previous)
        }
        const active = [...this.uploads.values()].filter((upload) => upload.state !== 'cancelled')
        const total = active.reduce((size, upload) => size + upload.byteLength, input.byteLength)
        const device = active
          .filter((upload) => upload.quotaKey === owner.quotaKey)
          .reduce((size, upload) => size + upload.byteLength, input.byteLength)
        if (total > fileIntakeLimits.stagingBytes || device > fileIntakeLimits.ownerBytes || this.uploads.size >= 256)
          throw new FileIntakeError('RESOURCE_EXHAUSTED', 'Upload staging capacity reached')
        const upload: Upload = {
          ...input,
          ...owner,
          offset: 0,
          epoch: 0,
          state: 'receiving',
          createdAt: Date.now(),
          expiresAt: Date.now() + fileIntakeLimits.retentionMs
        }
        await mkdir(path.dirname(this.file(upload)), { recursive: true })
        const handle = await open(this.file(upload), 'wx', 0o600)
        await handle.sync()
        await handle.close()
        await this.syncDirectory(path.dirname(this.file(upload)))
        await this.save(upload)
        await this.syncDirectory(this.root())
        this.check()
        return this.snapshot(upload)
      })
    )
  }
  get(owner: FileIntakeOwner, id: string): Promise<FileIntakeSnapshot> {
    return this.serial(this.key(owner, id), async () => {
      const upload = this.find(owner, id)
      if (upload.state === 'verifying') this.verify(upload)
      return this.snapshot(upload)
    })
  }
  resume(owner: FileIntakeOwner, input: FileIntakeResume): Promise<FileIntakeSnapshot> {
    return this.serial(this.key(owner, input.uploadId), async () => {
      const upload = this.find(owner, input.uploadId)
      if (upload.resumeId === input.resumeId) return this.snapshot(upload)
      if (String(upload.epoch) !== input.expectedWriterEpoch)
        throw new FileIntakeError('CONFLICT', 'Upload writer changed')
      const resumed = { ...upload, epoch: upload.epoch + 1, resumeId: input.resumeId }
      await this.save(resumed)
      return this.snapshot(resumed)
    })
  }
  write(owner: FileIntakeOwner, input: FileIntakeWrite): Promise<FileIntakeSnapshot> {
    return this.serial(this.key(owner, input.uploadId), async () => {
      const upload = this.find(owner, input.uploadId)
      if (String(upload.epoch) !== input.writerEpoch) throw new FileIntakeError('CONFLICT', 'Upload writer changed')
      const offset = Number(input.offset)
      const bytes = Buffer.from(input.bytes)
      if (
        !bytes.length ||
        bytes.length > fileIntakeLimits.chunkBytes ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > upload.offset ||
        offset + bytes.length > upload.byteLength
      )
        throw new FileIntakeError('CONFLICT', 'Invalid upload chunk or offset')
      const handle = await open(this.file(upload), 'r+')
      try {
        if (offset < upload.offset) {
          if (offset + bytes.length > upload.offset) throw new FileIntakeError('CONFLICT', 'Overlapping upload chunk')
          const stored = Buffer.alloc(bytes.length)
          const { bytesRead } = await handle.read(stored, 0, stored.length, offset)
          if (bytesRead !== bytes.length || !stored.equals(bytes))
            throw new FileIntakeError('IDEMPOTENCY_CONFLICT', 'Upload chunk changed')
          return this.snapshot(upload)
        }
        if (upload.state !== 'receiving') throw new FileIntakeError('CONFLICT', 'Upload is not receiving')
        await handle.truncate(upload.offset)
        let written = 0
        while (written < bytes.length) {
          const result = await handle.write(bytes, written, bytes.length - written, offset + written)
          if (!result.bytesWritten) throw new Error('Upload write made no progress')
          written += result.bytesWritten
        }
        await handle.sync()
        const next = { ...upload, offset: offset + bytes.length, expiresAt: this.touch(upload) }
        await this.save(next)
        this.check()
        return this.snapshot(next)
      } finally {
        await handle.close()
      }
    })
  }
  complete(owner: FileIntakeOwner, input: { uploadId: string; writerEpoch: string }): Promise<FileIntakeSnapshot> {
    return this.serial(this.key(owner, input.uploadId), async () => {
      const upload = this.find(owner, input.uploadId)
      if (String(upload.epoch) !== input.writerEpoch) throw new FileIntakeError('CONFLICT', 'Upload writer changed')
      if (upload.offset !== upload.byteLength) throw new FileIntakeError('CONFLICT', 'Upload is incomplete')
      if (upload.state === 'receiving')
        await this.save({ ...upload, state: 'verifying', expiresAt: this.touch(upload) })
      const current = this.find(owner, input.uploadId)
      if (current.state === 'verifying') this.verify(current)
      return this.snapshot(current)
    })
  }
  private verify(upload: Upload): void {
    const key = this.key(upload, upload.uploadId)
    if (this.verifying.has(key) || this.stopped) return
    const work = this.verificationSlots
      .runExclusive(async () => {
        if (this.stopped || this.uploads.get(key)?.state !== 'verifying') return
        let digest = upload.sha256
        if (!digest) {
          const hash = createHash('sha256')
          for await (const bytes of createReadStream(this.file(upload))) {
            if (this.stopped) return
            hash.update(bytes)
          }
          digest = hash.digest('hex')
        }
        await this.serial(key, async () => {
          const current = this.uploads.get(key)
          if (current?.state !== 'verifying') return
          this.check()
          const publication = {
            ...current,
            sha256: digest,
            entryId: current.entryId ?? FileEntryIdSchema.parse(uuidv7())
          }
          await this.save(publication)
          const entry = await application.get('FileManager').publishIntake({
            entryId: publication.entryId,
            filename: current.filename,
            byteLength: current.byteLength,
            sha256: digest,
            path: AbsoluteFilePathSchema.parse(this.file(current))
          })
          if (this.stopped) return
          await this.save({ ...current, sha256: digest, entryId: entry.id, state: 'ready' })
        })
      })
      .catch(async (error) => {
        if (this.stopped) return
        logger.warn('Upload verification failed', { key, error })
        await this.serial(key, async () => {
          const current = this.uploads.get(key)
          if (current?.state === 'verifying' && !current.entryId) await this.save({ ...current, state: 'failed' })
        }).catch((failure) => logger.warn('Upload failure persistence deferred', { key, failure }))
      })
      .finally(() => this.verifying.delete(key))
    this.verifying.set(key, work)
  }
  cancel(owner: FileIntakeOwner, id: string) {
    return this.serial(this.key(owner, id), async () => {
      this.check()
      const upload = this.uploads.get(this.key(owner, id))
      if (upload) {
        await this.save({ ...upload, state: 'cancelled' })
        if (!this.pins.has(this.key(owner, id))) {
          await rm(path.dirname(this.file(upload)), { recursive: true, force: true })
        }
      }
      return { cancelled: true as const }
    })
  }
  withEntries<T>(
    owner: FileIntakeOwner,
    refs: { uploadId: string }[],
    run: (entries: FileIntakeEntry[]) => Promise<T>
  ): Promise<T> {
    this.check()
    const work = this.importFiles(owner, refs, run)
    this.work.add(work)
    void work.finally(() => this.work.delete(work)).catch(() => undefined)
    return work
  }
  private async importFiles<T>(
    owner: FileIntakeOwner,
    refs: { uploadId: string }[],
    run: (entries: FileIntakeEntry[]) => Promise<T>
  ): Promise<T> {
    const pinned: Upload[] = []
    try {
      for (const ref of refs)
        await this.serial(this.key(owner, ref.uploadId), async () => {
          const upload = this.find(owner, ref.uploadId)
          if (upload.state !== 'ready') throw new FileIntakeError('CONFLICT', 'Attachment is not ready')
          const key = this.key(upload, upload.uploadId)
          this.pins.set(key, (this.pins.get(key) ?? 0) + 1)
          pinned.push(upload)
        })
      const entries: FileIntakeEntry[] = []
      for (const upload of pinned) {
        const manager = application.get('FileManager')
        if (!upload.entryId || !upload.sha256) throw new FileIntakeError('CONFLICT', 'Attachment is not published')
        const entry = await manager.getById(upload.entryId)
        entries.push({
          entryId: entry.id,
          filename: upload.filename,
          mediaType: upload.mediaType,
          sha256: upload.sha256,
          byteLength: upload.byteLength
        })
      }
      this.check()
      return await run(entries)
    } finally {
      for (const upload of pinned) {
        const key = this.key(upload, upload.uploadId)
        const remaining = (this.pins.get(key) ?? 1) - 1
        if (remaining) this.pins.set(key, remaining)
        else {
          this.pins.delete(key)
        }
      }
    }
  }
  sweep(): void {
    if (this.stopped || this.sweeping || !this.loading || hasPendingRestore()) return
    this.sweeping = true
    void this.load()
      .then(async () => {
        for (const [key] of this.uploads)
          await this.serial(key, async () => {
            const upload = this.uploads.get(key)
            if (!upload || this.pins.has(key) || this.verifying.has(key)) return
            if (upload.expiresAt <= Date.now()) {
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
  async drain(): Promise<void> {
    this.stopped = true
    while (this.queues.size || this.verifying.size || this.work.size)
      await Promise.allSettled([...this.queues.values(), ...this.verifying.values(), ...this.work])
  }
}
