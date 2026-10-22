import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { FileObservationLease } from '@shared/ipc/schemas/fileObservation'
import type { AbsoluteFilePath } from '@shared/types/file'

const logger = loggerService.withContext('FileEditObservation')
interface Scope {
  listeners: Set<(available: boolean) => void>
  lease?: FileObservationLease
  sequence: number
  changes: number
  active: boolean
  stopped: boolean
  retries: number
  timer?: ReturnType<typeof setTimeout>
  stopEvents: () => void
  ready: Promise<void>
}
interface ObservationSubscription {
  dispose(): void
  ready: Promise<void>
  isActive(): boolean
  getSequence(): number
}

export class FileEditObservation {
  private readonly scopes = new Map<string, Scope>()

  subscribe(rootPath: AbsoluteFilePath, invalidate: (available: boolean) => void): ObservationSubscription {
    let scope = this.scopes.get(rootPath)
    if (!scope) {
      scope = {
        listeners: new Set(),
        sequence: 0,
        changes: 0,
        active: false,
        stopped: false,
        retries: 0,
        stopEvents: () => {},
        ready: Promise.resolve()
      }
      this.scopes.set(rootPath, scope)
      scope.ready = this.start(rootPath, scope)
    }
    scope.listeners.add(invalidate)
    const current = scope
    return {
      ready: current.ready,
      isActive: () => current.active,
      getSequence: () => current.changes,
      dispose: () => {
        current.listeners.delete(invalidate)
        if (current.listeners.size || current.stopped) return
        current.stopped = true
        this.scopes.delete(rootPath)
        clearTimeout(current.timer)
        current.stopEvents()
        void current.ready
          .then(() => this.disposeLease(current))
          .catch((error) => logger.error('File observation cleanup failed', error))
      }
    }
  }

  private invalidate(scope: Scope): void {
    scope.changes++
    for (const listener of scope.listeners) listener(scope.active)
  }

  private retry(root: AbsoluteFilePath, scope: Scope): void {
    scope.active = false
    this.invalidate(scope)
    if (scope.stopped || scope.timer) return
    scope.timer = setTimeout(
      () => {
        scope.timer = undefined
        scope.stopEvents()
        scope.ready = this.disposeLease(scope)
          .then(async () => {
            if (!scope.stopped) await this.start(root, scope)
          })
          .catch((error) => {
            logger.warn('File observation restart failed', error instanceof Error ? error : new Error(String(error)))
            this.retry(root, scope)
          })
      },
      Math.min(1000 * 2 ** scope.retries++, 30_000)
    )
  }

  private async disposeLease(scope: Scope): Promise<void> {
    if (!scope.lease) return
    const lease = scope.lease
    scope.lease = undefined
    await ipcApi.request('file.observe.dispose', { observationId: lease.observationId })
  }

  private async start(rootPath: AbsoluteFilePath, scope: Scope): Promise<void> {
    try {
      const lease = await ipcApi.request('file.observe.create', { rootPath, options: { recursive: false } })
      scope.lease = lease
      scope.sequence = 0
      if (scope.stopped) return
      scope.stopEvents = ipcApi.on('file.observe.event', (event) => {
        if (
          scope.stopped ||
          event.observationId !== lease.observationId ||
          event.generation !== lease.generation ||
          event.sequence <= scope.sequence
        )
          return
        const gap = event.sequence !== scope.sequence + 1
        scope.sequence = event.sequence
        if (gap || event.kind === 'resync-required') this.retry(rootPath, scope)
        else this.invalidate(scope)
      })
      const activated = await ipcApi.request('file.observe.activate', lease)
      if (!scope.stopped) {
        scope.active = activated && scope.timer === undefined
        if (!scope.active) this.retry(rootPath, scope)
        else {
          scope.retries = 0
          this.invalidate(scope)
        }
      }
    } catch (error) {
      if (!scope.stopped) {
        logger.warn('File observation unavailable', error instanceof Error ? error : new Error(String(error)))
        this.retry(rootPath, scope)
      }
    }
  }
}
