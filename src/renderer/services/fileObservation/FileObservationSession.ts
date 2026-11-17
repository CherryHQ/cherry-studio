import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { FileHandle } from '@shared/data/types/file'
import type { FileObservationCoverage, FileObservationResource } from '@shared/ipc/schemas/fileObservation'

const logger = loggerService.withContext('FileObservationSession')
const IDLE_RELEASE_MS = 10_000

export interface FileObservationState {
  readonly version: number
  readonly coverage: 'starting' | FileObservationCoverage
  readonly error: Error | null
}

export class FileObservationSession {
  private state: FileObservationState = { version: 0, coverage: 'starting', error: null }
  private readonly listeners = new Set<() => void>()
  private readonly waiters = new Set<() => void>()
  private release?: () => void
  private idleTimer?: ReturnType<typeof setTimeout>
  private reconnect?: () => Promise<void>

  refresh = async (): Promise<void> => {
    if (this.state.coverage !== 'live') {
      await this.reconnect?.()
      await this.whenReady().catch(() => {})
    }
    this.update(this.state.coverage, this.state.error)
  }

  constructor(
    private readonly handle: FileHandle,
    private readonly onIdle: () => void
  ) {}

  getSnapshot = (): FileObservationState => this.state

  whenReady = async (): Promise<void> => {
    if (this.state.coverage === 'live') return
    if (this.state.coverage === 'unavailable') throw this.state.error ?? new Error('File observation unavailable')
    await new Promise<void>((resolve, reject) => {
      const listener = () => {
        if (this.state.coverage === 'live') {
          this.waiters.delete(listener)
          resolve()
        } else if (this.state.coverage === 'unavailable') {
          this.waiters.delete(listener)
          reject(this.state.error ?? new Error('File observation unavailable'))
        }
      }
      this.waiters.add(listener)
      listener()
    })
  }

  subscribe = (listener: () => void): (() => void) => {
    clearTimeout(this.idleTimer)
    this.listeners.add(listener)
    this.release ??= this.start()
    return () => {
      this.listeners.delete(listener)
      if (!this.listeners.size)
        this.idleTimer = setTimeout(() => {
          this.release?.()
          this.release = undefined
          this.onIdle()
        }, IDLE_RELEASE_MS)
    }
  }

  private update(coverage: FileObservationState['coverage'], error: Error | null = null): void {
    this.state = { version: this.state.version + 1, coverage, error }
    for (const listener of this.listeners) listener()
    for (const listener of this.waiters) listener()
  }

  private start(): () => void {
    let cancelled = false
    let resource: FileObservationResource | undefined
    let unsubscribe: (() => void) | undefined
    let connection: Promise<void> | undefined
    const close = () => {
      unsubscribe?.()
      unsubscribe = undefined
      if (resource) {
        const { subscriptionId } = resource
        resource = undefined
        void ipcApi
          .request('file.observe.close', { subscriptionId })
          .catch((error: unknown) => logger.warn('File observation cleanup failed', { error }))
      }
    }
    const connectOnce = async () => {
      if (cancelled) return
      close()
      if (this.state.coverage !== 'starting') this.update('starting')
      try {
        for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
          const opened = await ipcApi.request('file.observe.open', { handle: this.handle })
          resource = opened
          if (cancelled) {
            close()
            return
          }
          unsubscribe = ipcApi.on('file.observe.changed', (event) => {
            if (event.subscriptionId !== resource?.subscriptionId || event.revision <= resource.revision) return
            resource = event
            this.update(event.coverage)
            if (event.coverage !== 'live')
              queueMicrotask(() => {
                void connect()
              })
          })
          const activated = await ipcApi.request('file.observe.activate', {
            subscriptionId: opened.subscriptionId,
            revision: opened.revision
          })
          if (cancelled) return
          if (activated && resource?.coverage === 'live') {
            this.update('live')
            return
          }
          close()
        }
        if (!cancelled) throw new Error('File observation activation failed')
      } catch (error) {
        close()
        if (!cancelled) this.update('unavailable', error instanceof Error ? error : new Error(String(error)))
      }
    }
    const connect = (): Promise<void> => {
      connection ??= connectOnce().finally(() => {
        connection = undefined
      })
      return connection
    }
    const reconnect = async () => {
      await connection
      if (this.state.coverage !== 'live') await connect()
    }
    const revalidate = () => {
      if (cancelled || document.visibilityState === 'hidden') return
      if (this.state.coverage === 'live') this.update('live')
      else void connect()
    }
    this.reconnect = reconnect
    window.addEventListener('focus', revalidate)
    document.addEventListener('visibilitychange', revalidate)
    void connect()
    return () => {
      cancelled = true
      if (this.reconnect === reconnect) this.reconnect = undefined
      close()
      window.removeEventListener('focus', revalidate)
      document.removeEventListener('visibilitychange', revalidate)
    }
  }
}
