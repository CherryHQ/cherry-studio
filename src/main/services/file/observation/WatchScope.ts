import { loggerService } from '@logger'
import { Emitter, type Disposable } from '@main/core/lifecycle'
import type { FileObservationCoverage } from '@shared/ipc/schemas/fileObservation'
import type { AbsoluteFilePath } from '@shared/types/file'

import {
  createDirectoryWatcher,
  type CreateDirectoryWatcherOptions,
  type WatcherEvent,
  type DirectoryWatcherHost
} from '../watcher'

const logger = loggerService.withContext('WatchScope')

export type ObservationEvent = WatcherEvent | { readonly kind: 'stale' }

export interface ObservationLease extends Disposable {
  readonly ready: Promise<void>
  readonly revision: number
  readonly coverage: FileObservationCoverage
  disposeAsync(): Promise<void>
}

export class WatchScope {
  private readonly events = new Emitter<ObservationEvent>()
  readonly onEvent = this.events.event
  private readonly readiness = Promise.withResolvers<void>()
  readonly ready = this.readiness.promise
  private readonly watcher
  private readonly unsubscribe: () => void
  private closing?: Promise<void>
  needsRestart = false
  revision = 0
  coverage: FileObservationCoverage = 'stale'

  constructor(root: AbsoluteFilePath, options: CreateDirectoryWatcherOptions, host: DirectoryWatcherHost) {
    void this.ready.catch(() => {})
    this.watcher = createDirectoryWatcher(root, options, host)
    this.unsubscribe = this.watcher.onEvent((event) => {
      if (this.closing) return
      if (event.kind === 'ready') {
        this.coverage = 'live'
        this.readiness.resolve()
      } else if (event.kind === 'error') {
        this.needsRestart = true
        this.coverage = 'unavailable'
        this.readiness.reject(event.error)
      }
      this.revision++
      this.events.fire(event)
    })
  }

  invalidate(): void {
    if (this.closing) return
    this.needsRestart = true
    this.coverage = 'stale'
    this.revision++
    this.events.fire({ kind: 'stale' })
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      this.unsubscribe()
      this.readiness.reject(new Error('File observation closed before readiness'))
      this.events.dispose()
      await this.watcher.close().catch((error: unknown) => logger.error('Watcher close failed', { error }))
    })()
    return this.closing
  }
}
