// Browser `services/file/watcher`: ZenFS tells the watchers on a path's ancestors about every change
// made through it (`rename` when an entry is created or removed, `change` on a write). Changes made
// outside the Worker, such as a local folder edited on the computer, are not reported.
import { watch } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'

import { Emitter } from '@main/core/lifecycle'
import type { CreateDirectoryWatcherOptions, DirectoryWatcher, WatcherEvent } from '@main/services/file/watcher'
import type { AbsoluteFilePath } from '@shared/types/file'

import { listDirectory } from './fileTreeSearch'

export function createDirectoryWatcher(
  root: AbsoluteFilePath,
  options: CreateDirectoryWatcherOptions = {}
): DirectoryWatcher {
  const emitter = new Emitter<WatcherEvent>()
  // chokidar's depth counts the directories below the root, so 0 reports the root's own entries.
  const maxDepth = options.recursive === false ? 0 : (options.maxDepth ?? Infinity)

  const report = async (eventType: string, relativePath: string) => {
    const target = path.posix.join(root, relativePath) as AbsoluteFilePath
    if (relativePath.split('/').length - 1 > maxDepth || options.ignore?.(target)) return
    if (eventType === 'change') return emitter.fire({ kind: 'change', path: target })
    const stats = await stat(target).catch(() => undefined)
    emitter.fire(
      stats ? { kind: stats.isDirectory() ? 'addDir' : 'add', path: target } : { kind: 'unlink', path: target }
    )
  }

  // Events are reported in order: each waits for the previous one's `stat`.
  let queue = options.emitInitial
    ? listDirectory(root, { includeHidden: true, maxDepth: maxDepth + 1 }).then(
        async (paths) => {
          for (const entry of paths) await report('rename', path.posix.relative(root, entry))
        },
        () => undefined
      )
    : Promise.resolve()
  queue = queue.then(() => emitter.fire({ kind: 'ready' }))

  const watcher = watch(root, { recursive: true }, (eventType, filename) => {
    if (filename) queue = queue.then(() => report(eventType, String(filename)))
  })

  return {
    onEvent(listener) {
      const subscription = emitter.event(listener)
      return () => subscription.dispose()
    },
    async close() {
      watcher.close()
      emitter.dispose()
    }
  }
}
