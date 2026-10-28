import { createHash } from 'node:crypto'

import { LRUCache } from 'lru-cache'

import { application } from '@application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { dispatchHandle, readChunkByPath } from '@main/services/file'
import { stat } from '@main/utils/file'
import { HEIF_MAX_BYTES, type HeifPng, transcodeHeifToPng } from '@main/utils/image'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { HeifRendition, HeifRenditionSource } from '@shared/ipc/schemas/file'
import type { FileVersion } from '@shared/types/file'

interface Pending {
  content: Uint8Array
  revision: string
  deadline: number
  resolve: (value: HeifPng) => void
  reject: (error: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

@Injectable('HeifRenditionService')
@DependsOn(['FileManager'])
@ServicePhase(Phase.WhenReady)
export class HeifRenditionService extends BaseService {
  private readonly cache = new LRUCache<string, HeifPng>({
    max: 16,
    maxSize: HEIF_MAX_BYTES,
    sizeCalculation: (value) => value.content.byteLength,
    ttl: 300_000
  })
  private readonly inFlight = new Map<string, Promise<HeifPng>>()
  private readonly waiting: Pending[] = []
  private waitingBytes = 0
  private active: Pending | undefined
  private stopped = false

  async getRendition(source: HeifRenditionSource, signal?: AbortSignal): Promise<HeifRendition> {
    signal?.throwIfAborted()
    if (this.stopped) throw new IpcError(fileErrorCodes.HEIF_UNAVAILABLE)
    const { content, sourceVersion } = await this.readSource(source)
    signal?.throwIfAborted()
    if (this.stopped) throw new IpcError(fileErrorCodes.HEIF_UNAVAILABLE)
    const revision = 'heif-png-v1:' + createHash('sha256').update(content).digest('hex')
    const cached = this.cache.get(revision)
    const work = cached ? Promise.resolve(cached) : (this.inFlight.get(revision) ?? this.admit(content, revision))
    const png = await this.forConsumer(work, signal)
    return { ...png, revision, ...(sourceVersion && { sourceVersion }) }
  }

  private async readSource(source: HeifRenditionSource): Promise<{ content: Uint8Array; sourceVersion?: FileVersion }> {
    if (source.kind === 'bytes') {
      this.checkSize(source.content.byteLength)
      return { content: source.content }
    }
    try {
      const manager = application.get('FileManager')
      const before = await dispatchHandle(
        source,
        (id) => manager.getVersion(id),
        async (path) => {
          const info = await stat(path)
          return { size: info.size, mtime: info.modifiedAt }
        }
      )
      this.checkSize(before.size)
      const result = await dispatchHandle(
        source,
        (id) => manager.readChunk(id, 0, before.size),
        (path) => readChunkByPath(path, 0, before.size)
      )
      this.checkSize(result.version.size)
      if (result.content.byteLength !== result.version.size) throw new IpcError(fileErrorCodes.HEIF_READ_FAILED)
      return { content: result.content, sourceVersion: result.version }
    } catch (error) {
      if (error instanceof IpcError) throw error
      throw new IpcError(fileErrorCodes.HEIF_READ_FAILED)
    }
  }

  private checkSize(size: number): void {
    if (size > HEIF_MAX_BYTES) {
      throw new IpcError(fileErrorCodes.HEIF_TOO_LARGE, 'HEIF input exceeds the limit', { limit: 'input_bytes' })
    }
  }

  private admit(content: Uint8Array, revision: string): Promise<HeifPng> {
    if (this.active && (this.waiting.length >= 8 || this.waitingBytes + content.byteLength > 128 * 1024 * 1024)) {
      throw new IpcError(fileErrorCodes.HEIF_BUSY)
    }
    let pending!: Pending
    const work = new Promise<HeifPng>((resolve, reject) => {
      pending = {
        content: Uint8Array.from(content),
        revision,
        resolve,
        reject,
        deadline: Date.now() + 30_000,
        timer: setTimeout(() => {
          reject(new IpcError(fileErrorCodes.HEIF_TIMEOUT))
          const index = this.waiting.indexOf(pending)
          if (index >= 0) {
            this.waiting.splice(index, 1)
            this.waitingBytes -= pending.content.byteLength
          }
        }, 30_000)
      }
    })
    const tracked = work.finally(() => {
      this.inFlight.delete(revision)
    })
    this.inFlight.set(revision, tracked)
    if (this.active) {
      this.waiting.push(pending)
      this.waitingBytes += pending.content.byteLength
    } else {
      void this.run(pending)
    }
    return tracked
  }

  private async run(pending: Pending): Promise<void> {
    this.active = pending
    try {
      if (Date.now() >= pending.deadline) throw new IpcError(fileErrorCodes.HEIF_TIMEOUT)
      const png = await transcodeHeifToPng(pending.content)
      if (Date.now() >= pending.deadline) throw new IpcError(fileErrorCodes.HEIF_TIMEOUT)
      if (!this.stopped) this.cache.set(pending.revision, png)
      pending.resolve(png)
    } catch (error) {
      pending.reject(error)
    } finally {
      clearTimeout(pending.timer)
      this.active = undefined
      const next = this.waiting.shift()
      if (next) {
        this.waitingBytes -= next.content.byteLength
        void this.run(next)
      }
    }
  }

  private async forConsumer(work: Promise<HeifPng>, signal?: AbortSignal): Promise<HeifPng> {
    if (!signal) return work
    signal.throwIfAborted()
    let onAbort!: () => void
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason)
      signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      return await Promise.race([work, aborted])
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  protected onStop(): void {
    this.stopped = true
    for (const pending of [...this.waiting, ...(this.active ? [this.active] : [])]) {
      clearTimeout(pending.timer)
      pending.reject(new IpcError(fileErrorCodes.HEIF_UNAVAILABLE))
    }
    this.waiting.length = 0
    this.waitingBytes = 0
    this.inFlight.clear()
    this.cache.clear()
  }
}
