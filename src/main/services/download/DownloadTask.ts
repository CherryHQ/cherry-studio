import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { loggerService } from '@logger'

import type { DownloadSegmentRecord, DownloadStore, DownloadTaskRecord } from './downloadStore'
import { type DownloadProbe, type FetchLike, segmentHeaders } from './probe'
import { receivedBytes, resumeOffset, segmentLength, type ByteRange } from './segmentedDownload'

const logger = loggerService.withContext('DownloadTask')

/** The server answered a Range request with the whole body: the file changed. */
export class ValidatorChangedError extends Error {
  constructor() {
    super('The remote file changed since the download started')
    this.name = 'ValidatorChangedError'
  }
}

export class SegmentFailedError extends Error {
  constructor(
    readonly segment: number,
    cause: unknown
  ) {
    super(`Segment ${segment} failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'SegmentFailedError'
  }
}

/** Abort reason used when the user cancels, so settlement does not record a pause. */
export const DOWNLOAD_CANCELLED = 'download-cancelled'

export type DownloadRunResult = 'completed' | 'paused' | 'cancelled'

export interface DownloadTaskOptions {
  task: DownloadTaskRecord
  segments: DownloadSegmentRecord[]
  probe: DownloadProbe
  store: DownloadStore
  fetchImpl: FetchLike
  maxSegmentAttempts?: number
  /** Base backoff; tests pass 0 to keep the suite fast. */
  retryDelayMs?: number
  progressFlushBytes?: number
  progressFlushMs?: number
  onProgress?: (received: number, total: number) => void
}

/**
 * Runs one download to completion or to a clean pause.
 *
 * Segments write into the same sparse file at absolute offsets, so there is no
 * merge step and no second copy of the file. Progress is flushed to the store
 * every {@link progressFlushBytes} bytes (or {@link progressFlushMs}) and on
 * every segment boundary; a crash therefore costs at most one flush interval of
 * bookkeeping, never the bytes already on disk.
 */
export class DownloadTask {
  private readonly ranges: ByteRange[]
  private readonly received: number[]
  private readonly maxAttempts: number
  private readonly retryDelayMs: number
  private readonly flushBytes: number
  private readonly flushMs: number
  private pendingBytes = 0
  private lastFlush = Date.now()

  constructor(private readonly options: DownloadTaskOptions) {
    this.ranges = options.segments.map((segment) => ({
      index: segment.idx,
      start: segment.start,
      end: segment.end
    }))
    this.received = options.segments.map((segment) => segment.received)
    this.maxAttempts = options.maxSegmentAttempts ?? 3
    this.retryDelayMs = options.retryDelayMs ?? 500
    this.flushBytes = options.progressFlushBytes ?? 8 * 1024 * 1024
    this.flushMs = options.progressFlushMs ?? 1000
  }

  async run(signal: AbortSignal): Promise<DownloadRunResult> {
    const { task } = this.options
    await fs.mkdir(dirname(task.tempPath), { recursive: true })

    if (!this.options.probe.supportsRanges) {
      return this.runSingleStream(signal)
    }

    let createdTemp = false
    const handle = await fs.open(task.tempPath, 'r+').catch(async () => {
      createdTemp = true
      return fs.open(task.tempPath, 'w+')
    })
    try {
      // Recorded offsets describe bytes in the temporary file. If that file had
      // to be recreated, those bytes are gone (a cancel removed it, or a crash
      // landed between rename and complete): reusing the offsets would skip every
      // request and rename a sparse file of zeros over the destination.
      if (createdTemp && this.totalReceived() > 0) {
        logger.warn('Temporary file is missing; discarding recorded offsets', { taskId: task.id })
        this.received.fill(0)
        this.pendingBytes = 0
        this.options.store.resetOffsets(task.id)
      }
      await handle.truncate(task.totalBytes)
      this.options.store.setState(task.id, 'downloading')

      const controller = new AbortController()
      const onAbort = () => controller.abort()
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        const results = await Promise.allSettled(
          this.ranges.map((range) => this.runSegment(range, handle, controller.signal))
        )
        if (signal.aborted) {
          this.flush()
          if (signal.reason === DOWNLOAD_CANCELLED) return 'cancelled'
          this.options.store.setState(task.id, 'paused')
          return 'paused'
        }
        const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
        if (failure) {
          const reason = failure.reason
          this.flush()
          this.options.store.setState(task.id, 'failed', errorMessage(reason))
          throw reason
        }
      } finally {
        signal.removeEventListener('abort', onAbort)
      }

      this.flush()
      const stat = await handle.stat()
      if (stat.size !== task.totalBytes) {
        const message = `size mismatch: expected ${task.totalBytes}, got ${stat.size}`
        this.options.store.setState(task.id, 'failed', message)
        throw new Error(message)
      }
      await handle.sync()
    } finally {
      await handle.close()
    }

    this.options.store.setState(task.id, 'merging')
    try {
      await fs.rename(task.tempPath, task.filePath)
    } catch (error) {
      this.options.store.setState(task.id, 'failed', errorMessage(error))
      throw error
    }
    this.options.store.complete(task.id, task.filePath, task.totalBytes)
    return 'completed'
  }

  private async runSegment(range: ByteRange, handle: fs.FileHandle, signal: AbortSignal): Promise<void> {
    let attempts = 0
    while (this.received[range.index] < segmentLength(range)) {
      try {
        await this.streamSegment(range, handle, signal)
        this.flush()
        return
      } catch (error) {
        if (signal.aborted) throw error
        // A changed validator invalidates every segment, not just this one:
        // retrying would mix bytes from two different files.
        if (error instanceof ValidatorChangedError) throw error
        attempts += 1
        if (attempts >= this.maxAttempts) throw new SegmentFailedError(range.index, error)
        const backoff = this.retryDelayMs * 2 ** (attempts - 1)
        logger.warn('Retrying download segment', { segment: range.index, attempt: attempts, backoff })
        if (backoff > 0) await delay(backoff, undefined, { signal })
      }
    }
  }

  private async streamSegment(range: ByteRange, handle: fs.FileHandle, signal: AbortSignal): Promise<void> {
    const { probe, fetchImpl, task } = this.options
    const offset = resumeOffset(range, this.received[range.index])
    const response = await fetchImpl(probe.finalUrl, {
      headers: segmentHeaders(range, offset, probe),
      redirect: 'follow',
      signal
    })
    if (response.status === 200) throw new ValidatorChangedError()
    if (response.status !== 206) throw new Error(`expected HTTP 206, got ${response.status}`)
    const start = contentRangeStart(response.headers.get('content-range'))
    if (start !== null && start !== offset) {
      throw new Error(`server returned range starting at ${start}, expected ${offset}`)
    }
    if (!response.body) throw new Error('empty response body')

    const reader = response.body.getReader()
    let position = offset
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value?.length) continue
        if (position + value.length > range.end) throw new Error('server sent more bytes than requested')
        await handle.write(value, 0, value.length, position)
        position += value.length
        this.received[range.index] += value.length
        this.pendingBytes += value.length
        this.maybeFlush()
      }
    } finally {
      reader.releaseLock()
    }
    if (position !== range.end) {
      throw new Error(`segment ${range.index} ended at ${position}, expected ${range.end}`)
    }
    this.options.onProgress?.(this.totalReceived(), task.totalBytes)
  }

  /** Servers without Range support: one stream from zero, no resume. */
  private async runSingleStream(signal: AbortSignal): Promise<DownloadRunResult> {
    const { probe, fetchImpl, task, store } = this.options
    const response = await fetchImpl(probe.finalUrl, { redirect: 'follow', signal })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${probe.finalUrl}`)

    store.setState(task.id, 'downloading')
    const handle = await fs.open(task.tempPath, 'w')
    let position = 0
    try {
      const reader = response.body.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (!value?.length) continue
          await handle.write(value, 0, value.length, position)
          position += value.length
          this.received[0] = position
          this.pendingBytes += value.length
          this.maybeFlush()
        }
      } catch (error) {
        // Aborting a pending read rejects it before the settlement check below;
        // the abort is not a transfer failure.
        if (!signal.aborted) throw error
      } finally {
        reader.releaseLock()
      }
      if (signal.aborted) {
        this.flush()
        if (signal.reason === DOWNLOAD_CANCELLED) return 'cancelled'
        store.setState(task.id, 'paused')
        return 'paused'
      }
      await handle.sync()
    } finally {
      await handle.close()
    }

    store.setState(task.id, 'merging')
    await fs.rename(task.tempPath, task.filePath)
    store.complete(task.id, task.filePath, position)
    return 'completed'
  }

  private totalReceived(): number {
    return receivedBytes(this.ranges, this.received)
  }

  private maybeFlush(): void {
    const due = this.pendingBytes >= this.flushBytes || Date.now() - this.lastFlush >= this.flushMs
    if (due) this.flush()
  }

  private flush(): void {
    if (this.pendingBytes === 0) return
    const total = this.totalReceived()
    this.options.store.saveProgress(
      this.options.task.id,
      total,
      this.received.map((value, position) => ({ index: this.ranges[position].index, received: value }))
    )
    this.options.onProgress?.(total, this.options.task.totalBytes)
    this.pendingBytes = 0
    this.lastFlush = Date.now()
  }
}

function contentRangeStart(value: string | null): number | null {
  if (!value) return null
  const match = /^bytes\s+(\d+)-\d+\/\d+$/i.exec(value.trim())
  return match ? Number(match[1]) : null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
