import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Emitter, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type {
  FileObservationEvent,
  FileObservationLease,
  FileObservationOptions
} from '@shared/ipc/schemas/fileObservation'
import type { WindowId } from '@shared/ipc/types'
import type { AbsoluteFilePath } from '@shared/types/file'

import { normalizeAccessPath } from './utils/normalizeAccessPath'
import {
  createDirectoryWatcher,
  type CreateDirectoryWatcherOptions,
  type DirectoryWatcher,
  type WatcherEvent
} from './watcher'

const logger = loggerService.withContext('FileObservationManager')
interface SharedWatcher {
  watcher: DirectoryWatcher
  events: Emitter<WatcherEvent>
  unsubscribe: () => void
  references: number
  ready: boolean
  error?: Error
}
interface Observer {
  owner: WindowId
  lease: FileObservationLease
  watcher: DirectoryWatcher
  unsubscribe: () => void
  cancelReady: (reason: Error) => void
  active: boolean
  overflow: boolean
  sequence: number
  pending: FileObservationEvent[]
}

@Injectable('FileObservationManager')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager'])
export class FileObservationManager extends BaseService {
  private readonly shared = new Map<string, SharedWatcher>()
  private readonly observers = new Map<string, Observer>()
  private readonly closing = new Set<Promise<void>>()
  private readonly closedOwners = new Set<WindowId>()
  private stopped = false

  protected override onInit(): void {
    this.stopped = false
    this.registerDisposable(
      application.get('WindowManager').onWindowDestroyed(({ id }) => {
        this.closedOwners.add(id)
        void Promise.all(
          [...this.observers.values()]
            .filter((observer) => observer.owner === id)
            .map((observer) => this.dispose(id, observer.lease.observationId))
        ).catch((error) => logger.error('Failed to release observations', error))
      })
    )
  }

  protected override async onStop(): Promise<void> {
    this.stopped = true
    await Promise.all(
      [...this.observers.values()].map((observer) => this.dispose(observer.owner, observer.lease.observationId))
    )
    const remaining = [...this.shared.values()]
    this.shared.clear()
    await Promise.all(remaining.map((shared) => this.closeShared(shared)))
    await Promise.all(this.closing)
  }

  acquireWatcher(root: AbsoluteFilePath, options: CreateDirectoryWatcherOptions, policyKey: string): DirectoryWatcher {
    if (this.stopped) throw this.unavailable()
    const key = JSON.stringify([
      root,
      options.recursive ?? true,
      options.maxDepth,
      options.stabilityThresholdMs ?? 200,
      options.emitInitial ?? false,
      policyKey
    ])
    let shared = this.shared.get(key)
    if (!shared) {
      const watcher = createDirectoryWatcher(root, options)
      const record: SharedWatcher = {
        watcher,
        events: new Emitter(),
        unsubscribe: () => {},
        references: 0,
        ready: false
      }
      record.unsubscribe = watcher.onEvent((event) => {
        if (event.kind === 'ready') record.ready = true
        if (event.kind === 'error') record.error = event.error
        record.events.fire(event)
      })
      this.shared.set(key, record)
      shared = record
    }
    shared.references++
    const record = shared
    const subscriptions = new Set<() => void>()
    let closed: Promise<void> | undefined
    return {
      onEvent: (listener) => {
        if (closed) return () => {}
        let active = true
        const subscription = record.events.event(listener)
        const unsubscribe = () => {
          active = false
          subscription.dispose()
          subscriptions.delete(unsubscribe)
        }
        subscriptions.add(unsubscribe)
        if (record.ready || record.error)
          queueMicrotask(() => {
            if (active && !closed) listener(record.error ? { kind: 'error', error: record.error } : { kind: 'ready' })
          })
        return unsubscribe
      },
      close: () => {
        if (closed) return closed
        for (const unsubscribe of subscriptions) unsubscribe()
        record.references--
        if (record.references === 0 && this.shared.get(key) === record) {
          this.shared.delete(key)
          closed = this.closeShared(record)
        } else closed = Promise.resolve()
        return closed
      }
    }
  }

  async create(
    owner: WindowId,
    root: AbsoluteFilePath,
    options?: FileObservationOptions
  ): Promise<FileObservationLease> {
    if (this.stopped || this.closedOwners.has(owner)) throw this.unavailable()
    if ([...this.observers.values()].filter((observer) => observer.owner === owner).length >= 128) {
      throw new IpcError(fileErrorCodes.EDIT_LIMIT, 'Too many file observation subscriptions')
    }
    const normalizedRoot = normalizeAccessPath(root)
    const watcher = this.acquireWatcher(normalizedRoot, { ...options, emitInitial: false }, 'unfiltered')
    const ready = Promise.withResolvers<void>()
    const timeout = setTimeout(() => ready.reject(new Error('File observation startup timed out')), 15_000)
    timeout.unref()
    const lease = { observationId: randomUUID(), generation: randomUUID(), sequence: 0 }
    const observer: Observer = {
      owner,
      lease,
      watcher,
      unsubscribe: () => {},
      cancelReady: ready.reject,
      active: false,
      overflow: false,
      sequence: 0,
      pending: []
    }
    this.observers.set(lease.observationId, observer)
    observer.unsubscribe = watcher.onEvent((event) => {
      if (event.kind === 'ready') {
        ready.resolve()
        return
      }
      if (event.kind === 'error') ready.reject(event.error)
      const identity = { ...lease, sequence: ++observer.sequence }
      const update: FileObservationEvent =
        event.kind === 'error'
          ? { ...identity, kind: 'resync-required', reason: 'watcher-error' }
          : { ...identity, kind: 'invalidate', paths: [event.path], subtree: event.kind === 'unlinkDir' }
      if (observer.active) this.send(observer, update)
      else if (observer.pending.length < 1000 && !observer.overflow) observer.pending.push(update)
      else {
        observer.overflow = true
        observer.pending = []
      }
    })
    try {
      await ready.promise
      if (!this.observers.has(lease.observationId) || this.stopped) throw this.unavailable()
      return lease
    } catch (error) {
      await this.dispose(owner, lease.observationId)
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  activateObservation(owner: WindowId, lease: FileObservationLease): boolean {
    const observer = this.observers.get(lease.observationId)
    if (
      !observer ||
      observer.owner !== owner ||
      observer.lease.generation !== lease.generation ||
      lease.sequence !== 0 ||
      observer.overflow
    )
      return false
    if (observer.active) return true
    observer.active = true
    for (const event of observer.pending) this.send(observer, event)
    observer.pending = []
    return true
  }

  async dispose(owner: WindowId, observationId: string): Promise<void> {
    const observer = this.observers.get(observationId)
    if (!observer) return
    if (observer.owner !== owner) throw this.unavailable()
    this.observers.delete(observationId)
    observer.unsubscribe()
    observer.cancelReady(this.unavailable())
    await observer.watcher.close()
  }

  private send(observer: Observer, event: FileObservationEvent): void {
    application.get('IpcApiService').send(observer.owner, 'file.observe.event', event)
  }

  private closeShared(shared: SharedWatcher): Promise<void> {
    shared.unsubscribe()
    shared.events.dispose()
    const closing = shared.watcher.close()
    this.closing.add(closing)
    void closing.then(
      () => {
        this.closing.delete(closing)
      },
      () => {
        this.closing.delete(closing)
      }
    )
    return closing
  }

  private unavailable(): IpcError {
    return new IpcError(fileErrorCodes.DIRECTORY_TREE_STOPPED, 'File observation is unavailable')
  }
}
