import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FileEntryId } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('emits "add" for newly created files and writes "present" into DanglingCache', async () => {
    const target = path.join(dir, 'note.txt') as FilePath
    danglingCache.addEntry('e-w-add' as FileEntryId, target)

    const w = createDirectoryWatcher(dir as FilePath, { stabilityThresholdMs: 0 })
    await waitForReady(w)
    await writeFile(target, 'hello')
    const ev = await waitForEvent(w, (e) => e.kind === 'add' && e.path === target)
    expect(ev.kind).toBe('add')
    expect(
      await danglingCache.check({
        id: 'e-w-add' as FileEntryId,
        origin: 'external',
        externalPath: target,
        name: 'note',
        ext: 'txt',
        size: null,
        trashedAt: null,
        createdAt: 0,
        updatedAt: 0
      } as never)
    ).toBe('present')
    await w.close()
  })

  it('emits "unlink" for removed files and writes "missing" into DanglingCache', async () => {
    const target = path.join(dir, 'gone.txt') as FilePath
    await writeFile(target, 'soon-to-go')
    danglingCache.addEntry('e-w-unlink' as FileEntryId, target)
    danglingCache.onFsEvent(target, 'present')

    const w = createDirectoryWatcher(dir as FilePath, { stabilityThresholdMs: 0 })
    await waitForReady(w)
    await rm(target)
    const ev = await waitForEvent(w, (e) => e.kind === 'unlink' && e.path === target)
    expect(ev.kind).toBe('unlink')
    expect(
      await danglingCache.check({
        id: 'e-w-unlink' as FileEntryId,
        origin: 'external',
        externalPath: target,
        name: 'gone',
        ext: 'txt',
        size: null,
        trashedAt: null,
        createdAt: 0,
        updatedAt: 0
      } as never)
    ).toBe('missing')
    await w.close()
  })

  it('emits "change" when a watched file is modified in place', async () => {
    const target = path.join(dir, 'mut.txt') as FilePath

    // Default stabilityThresholdMs (200) keeps chokidar's event sequencing
    // deterministic across busy CI hosts; stability=0 was flaky on macOS
    // FSEvents when many tests share tmpdir traffic.
    const w = createDirectoryWatcher(dir as FilePath)
    await waitForReady(w)

    // First write registers the file (fires 'add'); second write fires 'change'.
    await writeFile(target, 'v1')
    await waitForEvent(w, (e) => e.kind === 'add' && e.path === target, 8000)
    // Brief settle so chokidar's awaitWriteFinish window closes on the add.
    await new Promise((r) => setTimeout(r, 250))
    await writeFile(target, 'v2-content-larger')
    const ev = await waitForEvent(w, (e) => e.kind === 'change' && e.path === target, 8000)
    expect(ev.kind).toBe('change')
    await w.close()
  })

  it('suppresses .DS_Store events via the built-in ignore set', async () => {
    const w = createDirectoryWatcher(dir as FilePath, { stabilityThresholdMs: 0 })
    await waitForReady(w)
    const seen: WatcherEvent[] = []
    w.onEvent((e) => seen.push(e))
    await writeFile(path.join(dir, '.DS_Store'), 'noise')
    await new Promise((r) => setTimeout(r, 600))
    expect(seen.find((e) => (e.kind === 'add' || e.kind === 'change') && e.path?.endsWith('.DS_Store'))).toBeUndefined()
    await w.close()
  })

  it('close() is idempotent and stops further event delivery', async () => {
    const w = createDirectoryWatcher(dir as FilePath, { stabilityThresholdMs: 0 })
    await waitForReady(w)
    await w.close()
    await w.close() // idempotent

    const seen: WatcherEvent[] = []
    w.onEvent((e) => seen.push(e))
    await writeFile(path.join(dir, 'late.txt'), 'late')
    await new Promise((r) => setTimeout(r, 400))
    expect(seen).toEqual([])
  })
})
