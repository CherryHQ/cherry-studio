import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AbsoluteFilePathSchema } from '@shared/types/file'

import * as watcherModule from '../../watcher'
import type { WatcherEvent, WatcherListener } from '../../watcher'
import { createDirectoryTree } from '../builder'

const scan = vi.hoisted(() => vi.fn<() => Promise<string[]>>())
vi.mock('../search', () => ({ listDirectory: scan }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createDirectoryTree initialization failure cleanup', () => {
  let root: string
  let pauseClose: boolean
  const watchers: Array<{
    ready: boolean
    closing: boolean
    closed: boolean
    listeners: Set<WatcherListener>
    emit: (event: WatcherEvent) => void
    release: () => void
    cleanup: () => Promise<void>
  }> = []

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cherry-tree-init-'))
    pauseClose = false
    watchers.length = 0
    scan.mockReset().mockResolvedValue([])
    const createWatcher = watcherModule.createDirectoryWatcher
    vi.spyOn(watcherModule, 'createDirectoryWatcher').mockImplementation((...args) => {
      const watcher = createWatcher(...args)
      const close = watcher.close.bind(watcher)
      const subscribe = watcher.onEvent.bind(watcher)
      const gate = deferred<void>()
      const listeners = new Set<WatcherListener>()
      const control = {
        ready: false,
        closing: false,
        closed: false,
        listeners,
        emit: (event: WatcherEvent) => {
          for (const listener of listeners) listener(event)
        },
        release: () => gate.resolve(),
        cleanup: close
      }
      watchers.push(control)
      vi.spyOn(watcher, 'onEvent').mockImplementation((listener) => {
        listeners.add(listener)
        const unsubscribe = subscribe((event) => {
          if (event.kind === 'ready') control.ready = true
          listener(event)
        })
        return () => {
          listeners.delete(listener)
          unsubscribe()
        }
      })
      vi.spyOn(watcher, 'close').mockImplementation(async () => {
        control.closing = true
        if (pauseClose) await gate.promise
        await close()
        control.closed = true
      })
      return watcher
    })
  })

  afterEach(async () => {
    for (const watcher of watchers) watcher.release()
    await Promise.all(watchers.map((watcher) => watcher.cleanup()))
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  it('waits for watcher shutdown before reporting the original scan failure', async () => {
    const pendingScan = deferred<string[]>()
    scan.mockReturnValueOnce(pendingScan.promise)
    pauseClose = true
    let settled = false
    const failure = new Error('initial scan failed')
    const result = createDirectoryTree(root, { respectGitignore: false }).catch((error) => {
      settled = true
      return error
    })
    await vi.waitFor(() => expect(watchers[0]?.ready).toBe(true), { timeout: 4000 })
    pendingScan.reject(failure)
    await vi.waitFor(() => expect(watchers[0].closing).toBe(true))
    expect(settled).toBe(false)
    expect(watchers[0].listeners.size).toBe(0)
    watchers[0].release()
    expect(await result).toBe(failure)
    expect(watchers[0].closed).toBe(true)
  })

  it('does not leave live watchers behind across failed retries before ready', async () => {
    const failure = new Error('scanner unavailable')
    scan.mockRejectedValue(failure)
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(createDirectoryTree(root, { respectGitignore: false })).rejects.toBe(failure)
      expect(watchers.every((watcher) => watcher.closed && watcher.listeners.size === 0)).toBe(true)
    }
  })

  it('drops queued watcher events when the initial scan rejects', async () => {
    const pendingScan = deferred<string[]>()
    scan.mockReturnValueOnce(pendingScan.promise)
    const failure = new Error('scan interrupted')
    const result = createDirectoryTree(root, { respectGitignore: false }).catch((error) => error)
    await vi.waitFor(() => expect(watchers[0]?.ready).toBe(true), { timeout: 4000 })
    watchers[0].emit({ kind: 'add', path: AbsoluteFilePathSchema.parse(path.join(root, 'queued.txt')) })
    pendingScan.reject(failure)
    expect(await result).toBe(failure)
    expect(watchers[0].closed).toBe(true)
    expect(watchers[0].listeners.size).toBe(0)
  })

  it('closes a watcher that fails before ready without waiting for the pending scan', async () => {
    const pendingScan = deferred<string[]>()
    scan.mockReturnValueOnce(pendingScan.promise)
    const failure = new Error('watcher startup failed')
    const result = createDirectoryTree(root, { respectGitignore: false }).catch((error) => error)
    watchers[0].emit({ kind: 'error', error: failure })
    expect(await result).toBe(failure)
    expect(watchers[0].closed).toBe(true)
    expect(watchers[0].listeners.size).toBe(0)
    pendingScan.resolve([])
  })
})
