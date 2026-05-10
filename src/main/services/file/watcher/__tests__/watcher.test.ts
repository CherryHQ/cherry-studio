import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FilePath } from '@shared/file/types'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { createDirectoryWatcher } = await import('../index')
const { danglingCache } = await import('../../danglingCache')

import type { DirectoryWatcher, WatcherEvent } from '../index'

const waitForReady = (w: DirectoryWatcher): Promise<void> =>
  new Promise<void>((resolve) => {
    const off = w.onEvent((e) => {
      if (e.kind === 'ready') {
        off()
        resolve()
      }
    })
  })

const waitForEvent = (
  w: DirectoryWatcher,
  pred: (e: WatcherEvent) => boolean,
  timeoutMs = 5000
): Promise<WatcherEvent> =>
  new Promise<WatcherEvent>((resolve, reject) => {
    const t = setTimeout(() => {
      off()
      reject(new Error(`watcher event timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    const off = w.onEvent((e) => {
      if (pred(e)) {
        clearTimeout(t)
        off()
        resolve(e)
      }
    })
  })

describe('createDirectoryWatcher', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'cherry-fm-watcher-'))
    danglingCache.clear()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('emits "ready" after the initial scan', async () => {
    const w = createDirectoryWatcher(dir as FilePath)
    await waitForReady(w)
    await w.close()
  })
})
