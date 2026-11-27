import path from 'node:path'

import { type FSWatcher, watch } from 'chokidar'
import ignore from 'ignore'

import type { WatcherInput, WatcherMessage } from './watcherProtocol'

const BUILTIN_IGNORE_BASENAMES = new Set(['.DS_Store', '.localized', 'Thumbs.db', 'desktop.ini'])

function createIgnore({ root, options }: WatcherInput): (candidate: string) => boolean {
  const filter = options.filter
  const rules = filter?.kind === 'tree' && filter.gitignoreRules ? ignore().add([...filter.gitignoreRules]) : null
  const normalizedRoot = root.replace(/\\/g, '/')
  return (candidate) => {
    if (BUILTIN_IGNORE_BASENAMES.has(path.basename(candidate))) return true
    if (!filter) return false
    const normalized = candidate.replace(/\\/g, '/')
    if (filter.kind === 'file') {
      return normalized !== filter.target && !filter.target.startsWith(`${normalized}/`)
    }
    if (filter.missingRoot) {
      const isTarget = normalized === filter.root || normalized.startsWith(`${filter.root}/`)
      const isAncestor = normalized === normalizedRoot || filter.root.startsWith(`${normalized}/`)
      if (!isTarget && !isAncestor) return true
      if (isAncestor && !isTarget) return false
    }
    const relative = path.posix.relative(filter.root, normalized)
    const isDescendant = relative !== '..' && !relative.startsWith('../')
    if (!filter.includeHidden && isDescendant && relative.split('/').some((segment) => segment.startsWith('.'))) {
      return true
    }
    return relative !== '' && isDescendant && (rules?.ignores(relative) ?? false)
  }
}

/** Owns native handles exclusively on the watcher thread. */
export class NativeWatcher {
  private watcher: FSWatcher
  private usingPolling = false
  private closed = false
  private closing?: Promise<void>
  private readonly retired: Promise<void>[] = []
  private readonly ignored: (candidate: string) => boolean

  constructor(
    private readonly input: WatcherInput,
    private readonly send: (message: WatcherMessage) => void
  ) {
    this.ignored = createIgnore(input)
    this.watcher = this.createWatcher(false)
  }

  private createWatcher(usePolling: boolean): FSWatcher {
    const { root, options } = this.input
    const stability = options.stabilityThresholdMs ?? 200
    const watcher = watch(root, {
      ignored: this.ignored,
      ignoreInitial: options.emitInitial !== true,
      depth: options.recursive === false ? 0 : options.maxDepth,
      awaitWriteFinish: stability > 0 ? { stabilityThreshold: stability, pollInterval: 100 } : false,
      usePolling,
      followSymlinks: options.followSymlinks ?? true
    })
    for (const kind of ['add', 'addDir', 'change', 'unlink', 'unlinkDir'] as const) {
      watcher.on(kind, (filePath) => {
        if (!this.closed) this.send({ kind, path: filePath })
      })
    }
    watcher.on('ready', () => {
      if (!this.closed) this.send({ kind: 'ready' })
    })
    watcher.on('error', (error: unknown) => this.handleError(error))
    return watcher
  }

  private handleError(error: unknown): void {
    if (this.closed) return
    const message = error instanceof Error ? error.message : String(error)
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    const windowsLock =
      process.platform === 'win32' &&
      (code === 'EPERM' || code === 'EBUSY' || message.includes('EPERM') || message.includes('EBUSY'))
    if (!this.usingPolling && (code === 'EMFILE' || message.includes('EMFILE') || windowsLock)) {
      this.send({ kind: 'warning', message: 'Native watcher failed; falling back to polling', error: message })
      const old = this.watcher
      old.removeAllListeners()
      this.usingPolling = true
      this.watcher = this.createWatcher(true)
      const closing = old.close()
      // Observe rejection immediately, while retaining it for final resource cleanup.
      void closing.catch((failure: unknown) => {
        this.send({ kind: 'warning', message: 'Failed to close native watcher', error: String(failure) })
      })
      this.retired.push(closing)
      return
    }
    this.send({ kind: 'error', message })
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.closed = true
      this.closing = Promise.allSettled([...this.retired, this.watcher.close()]).then((results) => {
        const failed = results.find((result) => result.status === 'rejected')
        if (failed?.status === 'rejected') throw failed.reason
      })
    }
    return this.closing
  }
}
