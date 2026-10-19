import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { app, dialog, session, shell } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { DownloadSource } from '@shared/data/types/download'

import { uniquifyFileName } from './downloadPath'
import { fileNameFromUrl, resolveDownloadPath, sanitizeDownloadFileName } from './downloadPath'
import type { DownloadConflictPolicy } from './downloadPath'
import { DownloadStore, type DownloadTaskRecord } from './downloadStore'
import { DownloadTask } from './DownloadTask'
import { probeDownload } from './probe'
import { planSegments, MAX_SEGMENT_CONNECTIONS } from './segmentedDownload'

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
  /** Paths claimed by tasks that have not touched the disk yet. */
  private readonly reserved = new Set<string>()
  private active = 0

  protected onInit(): void {
    this.store = new DownloadStore(application.get('DbService').getDb())
    this.registerDisposable(application.get('PreferenceService').subscribeChange(PREF.maxTasks, () => this.pump()))
    this.restore()
  }

  /** Requeues unfinished work; a crash during probing restarts from the probe. */
  private restore(): void {
    for (const task of this.store.listResumable()) {
      if (task.state !== 'paused' && task.state !== 'queued') this.store.setState(task.id, 'paused')
    }
    if (!application.get('PreferenceService').get(PREF.autoResume)) return
    for (const task of this.store.listResumable()) this.enqueue(task.id)
    this.pump()
  }

  list(): DownloadTaskRecord[] {
    return this.store.listAll()
  }

  get(taskId: string): DownloadTaskRecord | undefined {
    return this.store.get(taskId)?.task
  }

  async start(input: StartDownloadInput): Promise<DownloadTaskRecord> {
    const preferenceService = application.get('PreferenceService')
    const connections = clamp(preferenceService.get(PREF.connections) as number, 1, MAX_SEGMENT_CONNECTIONS)
    const policy = parsePolicy(preferenceService.get(PREF.conflict) as string)
    const baseDir = preferenceService.get(PREF.dir) || app.getPath('downloads')
    let fileName = sanitizeDownloadFileName(input.fileName || fileNameFromUrl(input.url))
    let dir = baseDir

    if (preferenceService.get(PREF.ask)) {
      const picked = await dialog.showSaveDialog({ defaultPath: join(baseDir, fileName) })
      if (picked.canceled || !picked.filePath) throw new Error('cancelled')
      dir = dirname(picked.filePath)
      fileName = basename(picked.filePath)
    }

    await fs.mkdir(dir, { recursive: true })
    const filePath = await this.reservePath(dir, fileName, policy)
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
  private async reservePath(dir: string, fileName: string, policy: DownloadConflictPolicy): Promise<string> {
    if (policy === 'overwrite') {
      const target = await resolveDownloadPath(dir, fileName, policy)
      this.reserved.add(target)
      return target
    }
    for (let attempt = 0; attempt < 10_000; attempt++) {
      const candidate = await resolveDownloadPath(dir, uniquifyFileName(fileName, attempt), policy)
      if (!this.reserved.has(candidate)) {
        this.reserved.add(candidate)
        return candidate
      }
    }
    throw new Error('could not reserve a free file name')
  }

  /** Aborts the transfer; the task stays resumable at its recorded offsets. */
  pause(taskId: string): void {
    this.running.get(taskId)?.abort()
    if (!this.running.has(taskId)) this.store.setState(taskId, 'paused')
  }

  resume(taskId: string): void {
    const entry = this.store.get(taskId)
    if (!entry || entry.task.state === 'completed') return
    this.store.setState(taskId, 'queued')
    this.enqueue(taskId)
    this.pump()
  }

  cancel(taskId: string): void {
    this.running.get(taskId)?.abort()
    const entry = this.store.get(taskId)
    if (entry?.task.filePath) this.reserved.delete(entry.task.filePath)
    this.store.setState(taskId, 'cancelled')
    if (entry?.task.tempPath) void fs.rm(entry.task.tempPath, { force: true }).catch(() => undefined)
  }

  /** Re-probes and restarts a failed task from zero. */
  async retry(taskId: string): Promise<void> {
    const entry = this.store.get(taskId)
    if (!entry) return
    const { task } = entry
    const probe = await probeDownload(task.url, this.fetchFor(task.partition))
    const ranges =
      probe.supportsRanges && probe.totalBytes > 0
        ? planSegments(probe.totalBytes, task.connections)
        : [{ index: 0, start: 0, end: 0 }]
    if (task.tempPath) await fs.rm(task.tempPath, { force: true }).catch(() => undefined)
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

  async remove(taskId: string): Promise<void> {
    this.running.get(taskId)?.abort()
    const entry = this.store.get(taskId)
    if (entry?.task.filePath) this.reserved.delete(entry.task.filePath)
    if (entry?.task.tempPath) await fs.rm(entry.task.tempPath, { force: true }).catch(() => undefined)
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

  private pump(): void {
    const max = clamp(application.get('PreferenceService').get(PREF.maxTasks) as number, 1, 10)
    while (this.active < max && this.queue.length > 0) {
      const taskId = this.queue.shift()!
      void this.runTask(taskId)
    }
  }

  private async runTask(taskId: string): Promise<void> {
    const entry = this.store.get(taskId)
    if (!entry || entry.task.state === 'completed' || entry.task.state === 'cancelled') return

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
        fetchImpl: this.fetchFor(task.partition)
      })
      const result = await runner.run(controller.signal)
      if (result === 'completed') logger.info('Download completed', { taskId, bytes: task.totalBytes })
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = errorMessage(error)
        this.store.setState(taskId, 'failed', message)
        logger.warn('Download failed', { taskId, error: message })
      }
    } finally {
      this.running.delete(taskId)
      this.active -= 1
      this.pump()
    }
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
