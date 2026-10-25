import { promises as fs, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { dialog, session, shell } from 'electron'
import { v7 as uuidv7 } from 'uuid'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { DownloadSource, DownloadState } from '@shared/data/types/download'

import { uniquifyFileName } from './downloadPath'
import { fileNameFromUrl, resolveDownloadPath, sanitizeDownloadFileName } from './downloadPath'
import type { DownloadConflictPolicy } from './downloadPath'
import { DownloadStore, type DownloadTaskRecord } from './downloadStore'
import { DOWNLOAD_CANCELLED, DownloadTask } from './DownloadTask'
import { probeDownload } from './probe'
import { planSegments, MAX_SEGMENT_CONNECTIONS } from './segmentedDownload'
import { SpeedMeter } from './speedMeter'

const logger = loggerService.withContext('DownloadManagerService')

const PREF = {
  dir: 'app.browser.downloads.dir',
  ask: 'app.browser.downloads.ask_where_to_save',
  maxTasks: 'app.browser.downloads.max_concurrent_tasks',
  connections: 'app.browser.downloads.connections_per_task',
  autoResume: 'app.browser.downloads.auto_resume',
  conflict: 'app.browser.downloads.conflict_policy',
  notify: 'app.browser.downloads.notify_on_complete'
} as const

export interface StartDownloadInput {
  url: string
  fileName?: string
  mime?: string
  partition?: string
  source?: DownloadSource
}

/** A task row plus the numbers a status consumer cannot derive from the database alone. */
export interface DownloadSnapshot {
  id: string
  fileName: string
  url: string
  state: DownloadState
  receivedBytes: number
  totalBytes: number
  /** 0-100 with one decimal; null while the size is still unknown. */
  percent: number | null
  speedBytesPerSecond: number
  /** Null when the size is unknown or the transfer is not running. */
  etaSeconds: number | null
  connections: number
  supportsRanges: boolean
  filePath: string
  error: string | null
}

export interface DownloadSnapshotOptions {
  /** Restricts the result to one task. Unknown ids yield an empty list. */
  taskId?: string
  limit?: number
}

/**
 * Owns the download queue. Tasks are rows in `download_task`; this service only
 * decides which rows may run now, and hands each one to {@link DownloadTask}.
 *
 * Transfers use the session that produced the download (`session.fetch`), so the
 * browser's cookies, proxy and certificate policy apply to the range requests
 * without copying credentials into the task row.
 */
@Injectable('DownloadManagerService')
@DependsOn(['DbService', 'PreferenceService'])
@ServicePhase(Phase.WhenReady)
export class DownloadManagerService extends BaseService {
  private store!: DownloadStore
  private readonly queue: string[] = []
  private readonly running = new Map<string, AbortController>()
  /**
   * Final and temporary paths claimed by tasks, keyed by the normalized path.
   * The value is the owning task id: a cancelled row keeps its recorded paths
   * after releasing them, so cleanup must never act on a path a newer task has
   * since claimed.
   */
  private readonly reserved = new Map<string, string>()
  /** One probe/reset per task; concurrent Retry clicks join the running one. */
  private readonly retries = new Map<string, Promise<void>>()
  /** Tasks whose row should be deleted once their live worker settles. */
  private readonly removals = new Set<string>()
  private readonly speeds = new SpeedMeter()
  private active = 0

  protected onInit(): void {
    this.store = new DownloadStore(application.get('DbService').getDb())
    this.registerDisposable(application.get('PreferenceService').subscribeChange(PREF.maxTasks, () => this.pump()))
    this.restore()
  }

  /** Requeues unfinished work; a crash during probing restarts from the probe. */
  private restore(): void {
    for (const task of this.store.listResumable()) {
      if (task.state === 'merging') {
        this.reconcileFinalization(task)
        continue
      }
      if (task.state !== 'paused' && task.state !== 'queued') this.store.setState(task.id, 'paused')
    }
    // Unfinished tasks own their destination across restarts. `resolveDownloadPath`
    // only sees files on disk, and an interrupted task usually has nothing but a
    // `.crdownload`, so without this a new download of the same name would claim
    // the same final and temporary paths and two writers would share one file.
    // Failed rows are included because Retry reuses their original paths.
    for (const task of this.store.listResumable()) {
      if (task.filePath) this.claim(task.filePath, task.id)
    }
    for (const task of this.store.listFailed()) {
      if (task.filePath) this.claim(task.filePath, task.id)
    }
    if (!application.get('PreferenceService').get(PREF.autoResume)) return
    for (const task of this.store.listResumable()) {
      // `runTask` only starts queued rows, so a restored task must be re-queued
      // explicitly rather than carrying its pre-restart state into the queue.
      this.store.setState(task.id, 'queued')
      this.enqueue(task.id)
    }
    this.pump()
  }

  /**
   * A crash between `rename()` and `complete()` leaves the row in `merging` with
   * no temporary file. If the destination already holds the payload the task is
   * done; otherwise the recorded offsets describe bytes that no longer exist and
   * must be discarded before any resume.
   */
  private reconcileFinalization(task: DownloadTaskRecord): void {
    const temp = statSync(task.tempPath, { throwIfNoEntry: false })
    if (temp) {
      // The rename never ran: the bytes are still in the temporary file.
      this.store.setState(task.id, 'paused')
      return
    }
    const destination = statSync(task.filePath, { throwIfNoEntry: false })
    if (destination && (task.totalBytes === 0 || destination.size === task.totalBytes)) {
      // A single-stream task may not know the length up front; the file size is
      // then the only truthful total.
      this.store.complete(task.id, task.filePath, task.totalBytes || destination.size)
      return
    }
    logger.warn('Finalized download has no usable payload; restarting from zero', { taskId: task.id })
    this.store.resetOffsets(task.id)
    this.store.setState(task.id, 'paused')
  }

  list(): DownloadTaskRecord[] {
    return this.store.listAll()
  }

  get(taskId: string): DownloadTaskRecord | undefined {
    return this.store.get(taskId)?.task
  }

  /**
   * Status view for the MCP tool and any future UI: the persisted row plus a
   * measured rate and the numbers derived from it.
   */
  snapshot(options: DownloadSnapshotOptions = {}): DownloadSnapshot[] {
    const rows = options.taskId
      ? [this.store.get(options.taskId)?.task].filter((task): task is DownloadTaskRecord => task !== undefined)
      : this.store.listAll(options.limit ?? 20)
    return rows.map((task) => this.toSnapshot(task))
  }

  private toSnapshot(task: DownloadTaskRecord): DownloadSnapshot {
    const speed = this.speeds.get(task.id)
    const remaining = task.totalBytes - task.receivedBytes
    return {
      id: task.id,
      fileName: task.fileName,
      url: task.url,
      state: task.state,
      receivedBytes: task.receivedBytes,
      totalBytes: task.totalBytes,
      percent:
        task.totalBytes > 0 ? Math.min(100, Math.round((task.receivedBytes / task.totalBytes) * 1000) / 10) : null,
      speedBytesPerSecond: Math.round(speed),
      etaSeconds: speed > 0 && remaining > 0 ? Math.ceil(remaining / speed) : null,
      connections: task.connections,
      supportsRanges: task.supportsRanges,
      filePath: task.filePath,
      error: task.error ?? null
    }
  }

  async start(input: StartDownloadInput): Promise<DownloadTaskRecord> {
    const preferenceService = application.get('PreferenceService')
    const connections = clamp(preferenceService.get(PREF.connections), 1, MAX_SEGMENT_CONNECTIONS)
    const policy = parsePolicy(preferenceService.get(PREF.conflict))
    // The path registry supplies the conventional Downloads fallback when the
    // OS lookup fails; `app.getPath` throws instead.
    const baseDir = preferenceService.get(PREF.dir) || application.getPath('sys.downloads')
    let fileName = sanitizeDownloadFileName(input.fileName || fileNameFromUrl(input.url))
    let dir = baseDir

    if (preferenceService.get(PREF.ask)) {
      const picked = await dialog.showSaveDialog({ defaultPath: join(baseDir, fileName) })
      if (picked.canceled || !picked.filePath) throw new Error('cancelled')
      dir = dirname(picked.filePath)
      fileName = basename(picked.filePath)
    }

    await fs.mkdir(dir, { recursive: true })
    // Allocate the id before the path so the reservation already names its
    // owner; a later cleanup can then tell this task's paths from a newer one's.
    const taskId = uuidv7()
    const filePath = await this.reservePath(dir, fileName, policy, taskId)
    const tempPath = `${filePath}.crdownload`
    const partition = input.partition ?? ''
    const fetchImpl = this.fetchFor(partition)

    try {
      const probe = await probeDownload(input.url, fetchImpl)
      const ranges =
        probe.supportsRanges && probe.totalBytes > 0
          ? planSegments(probe.totalBytes, connections)
          : [{ index: 0, start: 0, end: 0 }]
      const { task } = this.store.create({
        id: taskId,
        url: input.url,
        finalUrl: probe.finalUrl,
        fileName,
        filePath,
        tempPath,
        mime: input.mime ?? probe.mime,
        totalBytes: probe.totalBytes,
        connections,
        source: input.source ?? 'browser',
        partition,
        supportsRanges: probe.supportsRanges,
        etag: probe.etag,
        lastModified: probe.lastModified,
        ranges
      })
      this.enqueue(task.id)
      this.pump()
      return task
    } catch (error) {
      const message = errorMessage(error)
      const { task } = this.store.create({
        id: taskId,
        url: input.url,
        fileName,
        filePath,
        tempPath,
        mime: input.mime,
        totalBytes: 0,
        connections,
        source: input.source ?? 'browser',
        partition,
        supportsRanges: false,
        ranges: []
      })
      this.store.setState(task.id, 'failed', message)
      return task
    }
  }

  /**
   * Reserves a destination that neither the disk nor another in-flight task owns.
   * `resolveDownloadPath` only sees files that exist, so two downloads starting in
   * the same tick would otherwise pick the same name.
   */
  private async reservePath(
    dir: string,
    fileName: string,
    policy: DownloadConflictPolicy,
    owner: string = uuidv7()
  ): Promise<string> {
    if (policy === 'overwrite') {
      for (let attempt = 0; attempt < 10_000; attempt++) {
        // Only the requested name may overwrite; the alternatives allocated
        // around a live task must not clobber an unrelated existing file.
        const candidate = await resolveDownloadPath(
          dir,
          uniquifyFileName(fileName, attempt),
          attempt === 0 ? 'overwrite' : 'uniquify'
        )
        if (this.isReserved(candidate)) continue
        this.claim(candidate, owner)
        return candidate
      }
      throw new Error('could not reserve a free file name')
    }
    for (let attempt = 0; attempt < 10_000; attempt++) {
      const candidate = await resolveDownloadPath(dir, uniquifyFileName(fileName, attempt), policy)
      if (await this.pathTaken(candidate)) continue
      // Claim synchronously: another start may have completed its own
      // filesystem checks while this one was awaiting them.
      if (this.isReserved(candidate)) continue
      this.claim(candidate, owner)
      return candidate
    }
    throw new Error('could not reserve a free file name')
  }

  /**
   * Reserves both roles: a task owns its final path and its `.crdownload`, so a
   * download literally named `report.bin.crdownload` cannot alias the temporary
   * file of `report.bin`.
   */
  /** Case-insensitive volumes and Unicode normalization aliases map to one file. */
  private reservationKey(candidate: string): string {
    return candidate.normalize('NFC').toLowerCase()
  }

  private claim(filePath: string, owner: string): void {
    this.reserved.set(this.reservationKey(filePath), owner)
    this.reserved.set(this.reservationKey(`${filePath}.crdownload`), owner)
  }

  /** Only the recorded owner may release a path; stale rows must not free a newer task's file. */
  private release(filePath: string | null | undefined, owner: string): void {
    if (!filePath) return
    for (const key of [this.reservationKey(filePath), this.reservationKey(`${filePath}.crdownload`)]) {
      if (this.reserved.get(key) === owner) this.reserved.delete(key)
    }
  }

  /** True when `owner` still holds `candidate` as either its final or temporary path. */
  private owns(candidate: string, owner: string): boolean {
    const key = this.reservationKey(candidate)
    return this.reserved.get(key) === owner || this.reserved.get(`${key}.crdownload`) === owner
  }

  /** True when `candidate` is any task's final or temporary path. */
  private isReserved(candidate: string): boolean {
    const key = this.reservationKey(candidate)
    return this.reserved.has(key) || this.reserved.has(`${key}.crdownload`)
  }

  /**
   * A path is taken when another task reserved it, or when a stale
   * `.crdownload` still holds the name even though no task row points at it.
   */
  private async pathTaken(candidate: string): Promise<boolean> {
    if (this.isReserved(candidate)) return true
    return fs.stat(`${candidate}.crdownload`).then(
      () => true,
      () => false
    )
  }

  /** Aborts the transfer; the task stays resumable at its recorded offsets. */
  pause(taskId: string): void {
    const controller = this.running.get(taskId)
    if (controller) {
      controller.abort()
      return
    }
    // A paused entry must leave the queue, otherwise the next pump starts it
    // while the persisted state still says paused.
    this.dequeue(taskId)
    this.store.setState(taskId, 'paused')
  }

  resume(taskId: string): void {
    const entry = this.store.get(taskId)
    if (!entry || entry.task.state === 'completed') return
    this.store.setState(taskId, 'queued')
    this.enqueue(taskId)
    this.pump()
  }

  cancel(taskId: string): void {
    // The reason distinguishes a user cancel from a pause when the runner
    // settles; without it the abort path overwrites `cancelled` with `paused`.
    const controller = this.running.get(taskId)
    this.dequeue(taskId)
    if (controller) {
      // The worker may still be syncing or renaming. It keeps ownership until
      // it settles; `runTask` releases the paths and removes the temp file.
      controller.abort(DOWNLOAD_CANCELLED)
      this.store.setState(taskId, 'cancelled')
      return
    }
    const entry = this.store.get(taskId)
    // The recorded path may already belong to a newer task: a cancelled row
    // released it, that task reused the name, and this cleanup must not delete
    // the newcomer's temporary file or hand its reservation away.
    const ownsTemp = !!entry?.task.tempPath && this.owns(entry.task.tempPath, taskId)
    this.release(entry?.task.filePath, taskId)
    this.store.setState(taskId, 'cancelled')
    if (ownsTemp && entry) void fs.rm(entry.task.tempPath, { force: true }).catch(() => undefined)
  }

  /** Re-probes and restarts a failed task from zero. */
  async retry(taskId: string): Promise<void> {
    // The probe is a network round trip, so two clicks can overlap. They must
    // share one reset: otherwise the later probe reaches the row after the
    // earlier retry has completed it and requeues it with `tempPath: ''`.
    const inFlight = this.retries.get(taskId)
    if (inFlight) return inFlight
    const job = this.restartFailed(taskId).finally(() => this.retries.delete(taskId))
    this.retries.set(taskId, job)
    return job
  }

  private async restartFailed(taskId: string): Promise<void> {
    const entry = this.store.get(taskId)
    if (!entry) return
    const { task } = entry
    const probe = await probeDownload(task.url, this.fetchFor(task.partition))
    // The row can reach a terminal state while the probe is in flight: removed,
    // cancelled, or completed by the retry this call joined.
    if (!this.canRetry(taskId)) return
    const ranges =
      probe.supportsRanges && probe.totalBytes > 0
        ? planSegments(probe.totalBytes, task.connections)
        : [{ index: 0, start: 0, end: 0 }]
    if (task.tempPath) await fs.rm(task.tempPath, { force: true }).catch(() => undefined)
    // Removing the temporary file is another await; do not reset a row that
    // stopped being failed in the meantime.
    if (!this.canRetry(taskId)) return
    this.store.reset(taskId, {
      totalBytes: probe.totalBytes,
      supportsRanges: probe.supportsRanges,
      etag: probe.etag,
      lastModified: probe.lastModified,
      ranges
    })
    this.enqueue(taskId)
    this.pump()
  }

  /** Retry may only reset a row that is still failed. */
  private canRetry(taskId: string): boolean {
    return this.store.get(taskId)?.task.state === 'failed'
  }

  async remove(taskId: string): Promise<void> {
    this.dequeue(taskId)
    const controller = this.running.get(taskId)
    if (controller) {
      // An already-submitted rename cannot be cancelled. Deleting the row and its
      // temporary file now would let a newer same-name task claim both while the
      // old rename is still pending — and that rename would then consume the
      // newer task's payload. Defer the destructive half until the worker settles.
      this.removals.add(taskId)
      controller.abort(DOWNLOAD_CANCELLED)
      return
    }
    const entry = this.store.get(taskId)
    // A cancelled row keeps its old paths on disk. If a newer task has since
    // reused the name, this row no longer owns them and must leave them alone.
    const ownsTemp = !!entry?.task.tempPath && this.owns(entry.task.tempPath, taskId)
    this.release(entry?.task.filePath, taskId)
    if (ownsTemp && entry) await fs.rm(entry.task.tempPath, { force: true }).catch(() => undefined)
    this.store.delete(taskId)
  }

  async openFile(taskId: string): Promise<void> {
    const task = this.store.get(taskId)?.task
    if (task?.state === 'completed') await shell.openPath(task.filePath)
  }

  openFolder(taskId: string): void {
    const task = this.store.get(taskId)?.task
    if (task?.filePath) shell.showItemInFolder(task.filePath)
  }

  private enqueue(taskId: string): void {
    if (this.running.has(taskId) || this.queue.includes(taskId)) return
    this.queue.push(taskId)
  }

  private dequeue(taskId: string): void {
    const index = this.queue.indexOf(taskId)
    if (index >= 0) this.queue.splice(index, 1)
  }

  private pump(): void {
    const max = clamp(application.get('PreferenceService').get(PREF.maxTasks), 1, 10)
    while (this.active < max && this.queue.length > 0) {
      const taskId = this.queue.shift()!
      void this.runTask(taskId)
    }
  }

  private async runTask(taskId: string): Promise<void> {
    const entry = this.store.get(taskId)
    // Only an explicitly queued row may run: a pause or cancel that raced the
    // queue must not start a transfer without a matching resume.
    if (!entry || entry.task.state !== 'queued') return

    const controller = new AbortController()
    this.running.set(taskId, controller)
    this.active += 1
    const { task, segments } = entry

    try {
      const runner = new DownloadTask({
        task,
        segments,
        probe: {
          finalUrl: task.finalUrl ?? task.url,
          totalBytes: task.totalBytes,
          supportsRanges: task.supportsRanges,
          etag: task.etag ?? undefined,
          lastModified: task.lastModified ?? undefined,
          mime: task.mime ?? undefined
        },
        store: this.store,
        fetchImpl: this.fetchFor(task.partition),
        onProgress: (received) => {
          this.speeds.update(taskId, received)
        }
      })
      const result = await runner.run(controller.signal)
      if (result === 'completed') {
        this.release(task.filePath, taskId)
        logger.info('Download completed', { taskId, bytes: task.totalBytes })
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = errorMessage(error)
        this.store.setState(taskId, 'failed', message)
        logger.warn('Download failed', { taskId, error: message })
      }
    } finally {
      this.speeds.stop(taskId)
      this.running.delete(taskId)
      this.active -= 1
      const entry = this.store.get(taskId)
      if (this.removals.delete(taskId)) {
        // Settled: a submitted rename can no longer land on a reused path.
        await this.discardFiles(taskId, entry?.task)
        this.store.delete(taskId)
      } else if (entry?.task.state === 'cancelled') {
        // The worker kept ownership while it settled; release only what this
        // task still owns so a reused name is not torn down underneath it.
        await this.discardFiles(taskId, entry.task)
      } else if (entry?.task.state === 'queued') {
        // Resume arrived while the runner was closing its file. `enqueue` was
        // rejected then because the worker still occupied this id; dispatch now.
        this.enqueue(taskId)
      }
      this.pump()
    }
  }

  /** Releases what `task` still owns and removes its temporary file. */
  private async discardFiles(taskId: string, task: DownloadTaskRecord | undefined): Promise<void> {
    const ownsTemp = !!task?.tempPath && this.owns(task.tempPath, taskId)
    this.release(task?.filePath, taskId)
    if (ownsTemp && task) await fs.rm(task.tempPath, { force: true }).catch(() => undefined)
  }

  private fetchFor(partition: string): (input: string, init?: RequestInit) => Promise<Response> {
    const target = partition ? session.fromPartition(partition) : session.defaultSession
    return target.fetch.bind(target)
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function parsePolicy(value: string): DownloadConflictPolicy {
  return value === 'overwrite' || value === 'fail' ? value : 'uniquify'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
