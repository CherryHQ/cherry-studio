/** Chokidar adapter used by FileObservationService; also forwards presence changes to DanglingCache. */

import { loggerService } from '@logger'
import { Emitter } from '@main/core/lifecycle'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'

import { danglingCache } from './danglingCache'
import { watcherReplySchema, type WatcherMessage, type WatcherOptions, type WatcherCommand } from './watcherProtocol'
// oxlint-disable-next-line import/default -- Electron Vite exposes ?nodeWorker imports as default worker factories.
import createWatcherWorker from './watcherWorker?nodeWorker'

const logger = loggerService.withContext('file/watcher')

/**
 * Normalized FS event. Rename is represented as `unlink` + `add`; the watcher
 * does not infer identity across those events.
 *
 * Directory variants `addDir` / `unlinkDir` were added when the
 * `DirectoryTreeBuilder` primitive landed (see
 * `docs/dev/references/file/directory-tree.md`) — without them, folder
 * creation / deletion would never reach a subscribed tree builder because
 * chokidar reports those on dedicated channels.
 */
export type WatcherEvent =
  | { readonly kind: 'add'; readonly path: AbsoluteFilePath }
  | { readonly kind: 'addDir'; readonly path: AbsoluteFilePath }
  | { readonly kind: 'unlink'; readonly path: AbsoluteFilePath }
  | { readonly kind: 'unlinkDir'; readonly path: AbsoluteFilePath }
  | { readonly kind: 'change'; readonly path: AbsoluteFilePath }
  | { readonly kind: 'ready' }
  | { readonly kind: 'error'; readonly error: Error }

export type WatcherListener = (event: WatcherEvent) => void

export interface DirectoryWatcher {
  /**
   * Subscribe to normalized FS events. Returns an unsubscribe function.
   * Multiple subscribers are supported; delivery order across subscribers is
   * unspecified.
   */
  onEvent(listener: WatcherListener): () => void

  /**
   * Stop watching and release all OS-level resources. Idempotent.
   */
  close(): Promise<void>
}

export type CreateDirectoryWatcherOptions = WatcherOptions

type WatcherRuntime = {
  worker: ReturnType<typeof createWatcherWorker>
  completion: ReturnType<typeof Promise.withResolvers<void>>
  stopped: boolean
  failure?: Error
}

class DirectoryWatcherImpl implements DirectoryWatcher {
  private readonly emitter = new Emitter<WatcherEvent>()
  private readonly completion = Promise.withResolvers<void>()
  private readonly id: number
  private closed = false
  private closing?: Promise<void>

  constructor(
    root: AbsoluteFilePath,
    options: CreateDirectoryWatcherOptions,
    private readonly host: DirectoryWatcherHost
  ) {
    void this.completion.promise.catch(() => {})
    this.id = host.attach(this, root, options)
  }

  receive(event: WatcherMessage): void {
    if (event.kind === 'closed') {
      this.host.detach(this.id)
      this.completion.resolve()
    } else if (!this.closed) {
      if (event.kind === 'warning') logger.warn(event.message, { error: event.error })
      else if (event.kind === 'error') this.reportError(new Error(event.message))
      else if (event.kind === 'ready') this.emitter.fire(event)
      else this.handle(event)
    }
  }

  failed(error: Error): void {
    if (!this.closed) this.reportError(error)
    this.completion.reject(error)
  }

  private reportError(error: Error): void {
    logger.error('File watcher failed', error)
    this.emitter.fire({ kind: 'error', error })
  }

  /**
   * Validate a path emitted by chokidar. chokidar's public types only promise
   * `string`, but in our configuration (absolute root, no `cwd`) the emitted
   * paths should always satisfy `AbsoluteFilePathSchema`. This helper turns that
   * assumption into a checked invariant and returns `null` for any unexpected
   * value so callers can drop or ignore it safely.
   */
  private parseChokidarPath(raw: string): AbsoluteFilePath | null {
    const result = AbsoluteFilePathSchema.safeParse(raw)
    return result.success ? result.data : null
  }

  /**
   * Forward chokidar's `add` / `unlink` / `change` events to subscribers AND
   * mirror presence transitions into DanglingCache. `change` is intentionally
   * not mirrored — the file is still present; only mtime drift, which the
   * cache doesn't track.
   *
   * AbsoluteFilePath validation happens here, at the boundary between chokidar's
   * `string` events and the AbsoluteFilePath-typed consumers (`DanglingCache`,
   * `WatcherEvent` subscribers). Invalid paths are logged and dropped.
   *
   * DanglingCache's reverse index is keyed **byte-faithful**: it is populated
   * by `ensureExternalEntry`, whose `externalPath` is stored exactly as the OS
   * handed it (byte-faithful lexical form, no NFC). So the watcher matches
   * chokidar events by **raw byte equality** — no normalization on either leg.
   * (The NFC step that used to sit here existed only to bridge to the old
   * NFC-canonical keys; it is removed together with them.) On Linux the raw
   * event byte-matches the stored key by construction; on macOS/Windows it
   * matches when the path source and chokidar agree on Unicode form.
   *
   * `check()` — which stats the byte-faithful stored path directly — is the
   * correctness baseline, so a missed watcher match is never a correctness
   * bug: it only delays a badge update until the next `check()`, which is
   * benign and self-healing. See
   * `docs/dev/references/file/file-manager-architecture.md §11.3 "Watcher
   * Auto-Wiring"`.
   */
  private handle(ev: { kind: 'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change'; path: string }): void {
    if (this.closed) return
    const path = this.parseChokidarPath(ev.path)
    if (!path) {
      logger.warn('chokidar emitted a path that does not satisfy AbsoluteFilePathSchema', { path: ev.path })
      return
    }
    if (ev.kind === 'add' || ev.kind === 'unlink') {
      const presence = ev.kind === 'add' ? 'present' : 'missing'
      danglingCache.onFsEvent(path, presence, 'watcher')
    }
    this.emitter.fire({ kind: ev.kind, path })
  }

  onEvent(listener: WatcherListener): () => void {
    const subscription = this.emitter.event(listener)
    return () => subscription.dispose()
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.closed = true
      this.emitter.dispose()
      this.host.send({ kind: 'close', id: this.id })
      this.closing = this.completion.promise
    }
    return this.closing
  }
}

/** One lazy observation thread shared by the lifecycle service's scopes. */
export class DirectoryWatcherHost {
  private nextId = 0
  private readonly watchers = new Map<number, DirectoryWatcherImpl>()
  private runtime?: WatcherRuntime
  private stopping?: Promise<void>

  attach(watcher: DirectoryWatcherImpl, root: AbsoluteFilePath, options: CreateDirectoryWatcherOptions): number {
    if (this.stopping) throw new Error('File watcher host stopped')
    if (!this.runtime) {
      const runtime: WatcherRuntime = {
        worker: createWatcherWorker({}),
        completion: Promise.withResolvers<void>(),
        stopped: false
      }
      this.runtime = runtime
      void runtime.completion.promise.catch(() => {})
      runtime.worker.on('message', (raw: unknown) => {
        const reply = watcherReplySchema.safeParse(raw)
        if (!reply.success) {
          runtime.failure = reply.error
          void runtime.worker
            .terminate()
            .catch((error: unknown) => logger.error('Watcher termination failed', { error }))
        } else if (reply.data.kind === 'stopped') {
          runtime.stopped = true
          void runtime.worker.terminate().catch((error: unknown) => runtime.completion.reject(error))
        } else this.watchers.get(reply.data.id)?.receive(reply.data.event)
      })
      runtime.worker.on('error', (error) => {
        runtime.failure = error
      })
      runtime.worker.once('exit', (code) => {
        if (this.runtime === runtime) this.runtime = undefined
        const failure =
          runtime.failure ??
          (runtime.stopped ? undefined : new Error(`File watcher worker exited unexpectedly (${code})`))
        if (failure) {
          const clients = [...this.watchers.values()]
          this.watchers.clear()
          for (const client of clients) client.failed(failure)
          runtime.completion.reject(failure)
        } else runtime.completion.resolve()
      })
    }
    const id = ++this.nextId
    this.watchers.set(id, watcher)
    this.send({ kind: 'create', id, input: { root, options } })
    return id
  }

  detach(id: number): void {
    this.watchers.delete(id)
  }

  send(command: WatcherCommand): void {
    this.runtime?.worker.postMessage(command)
  }

  close(): Promise<void> {
    this.stopping ??= (async () => {
      await Promise.allSettled([...this.watchers.values()].map((watcher) => watcher.close()))
      const runtime = this.runtime
      if (runtime) {
        this.send({ kind: 'stop' })
        await runtime.completion.promise
      }
    })()
    return this.stopping
  }
}

/** Create a scope on the service-owned thread; presence changes still update DanglingCache on Main. */
export function createDirectoryWatcher(
  root: AbsoluteFilePath,
  opts: CreateDirectoryWatcherOptions,
  host: DirectoryWatcherHost
): DirectoryWatcher {
  return new DirectoryWatcherImpl(root, opts, host)
}
