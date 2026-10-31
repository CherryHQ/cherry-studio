import type * as fsModule from 'node:fs/promises'
import { mkdir, mkdtemp, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setImmediate } from 'node:timers/promises'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TreeMutationEvent } from '@shared/utils/file'

import * as watcherModule from '../../watcher'
import type { WatcherEvent } from '../../watcher'
import { createDirectoryTree, type DirectoryTreeBuilder } from '../builder'
import { tryTestRipgrepPath } from './ripgrepTestUtils'

const delayedStat = vi.hoisted(() => ({
  path: '',
  entered: false,
  release: () => {},
  gate: Promise.resolve()
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof fsModule>()
  return {
    ...fs,
    stat: async (...args: Parameters<typeof fs.stat>) => {
      const result = await fs.stat(...args)
      if (String(args[0]).replace(/\\/g, '/') === delayedStat.path && !delayedStat.entered) {
        delayedStat.entered = true
        await delayedStat.gate
      }
      return result
    }
  }
})

vi.mock('@main/utils/binaryResolver', async () => {
  const { tryTestRipgrepPath: tryPath } = await import('./ripgrepTestUtils')
  return { getBinaryPath: async (name?: string) => (name === 'rg' ? (tryPath() ?? '/nonexistent/rg') : (name ?? '')) }
})
vi.mock('@main/utils/binaryEnv', () => ({ getBinaryExecutionEnv: () => ({}) }))

describe.skipIf(tryTestRipgrepPath() === null)('directory tree pending watcher stats', () => {
  let root: string
  let builder: DirectoryTreeBuilder
  const events: TreeMutationEvent[] = []
  const rawEvents: WatcherEvent[] = []

  beforeEach(async () => {
    root = (await mkdtemp(path.join(tmpdir(), 'cherry-tree-events-'))).replace(/\\/g, '/')
    events.length = 0
    rawEvents.length = 0
    delayedStat.path = ''
    delayedStat.entered = false
    delayedStat.gate = new Promise<void>((resolve) => {
      delayedStat.release = resolve
    })
    const createWatcher = watcherModule.createDirectoryWatcher
    vi.spyOn(watcherModule, 'createDirectoryWatcher').mockImplementation((...args) => {
      const watcher = createWatcher(...args)
      watcher.onEvent((event) => rawEvents.push(event))
      return watcher
    })
    builder = await createDirectoryTree(root, { withStats: true, respectGitignore: false })
    builder.onMutation((event) => events.push(event))
  })

  afterEach(async () => {
    delayedStat.release()
    await setImmediate()
    await builder.disposeAsync()
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  async function pauseAdd(target: string, directory = false) {
    delayedStat.path = target
    if (directory) await mkdir(target)
    else await writeFile(target, 'note')
    await vi.waitFor(() => expect(delayedStat.entered).toBe(true), { timeout: 4000 })
  }

  async function waitForRaw(kind: 'unlink' | 'unlinkDir', target: string) {
    await vi.waitFor(
      () =>
        expect(rawEvents.some((event) => event.kind === kind && event.path.replace(/\\/g, '/') === target)).toBe(true),
      { timeout: 4000 }
    )
  }

  async function releaseStat() {
    delayedStat.release()
    await setImmediate()
  }

  it.each([false, true])('does not reinsert a deleted node (directory=%s)', async (directory) => {
    const target = `${root}/${directory ? 'folder' : 'note.md'}`
    await pauseAdd(target, directory)
    await rm(target, { recursive: directory })
    await waitForRaw(directory ? 'unlinkDir' : 'unlink', target)
    await releaseStat()
    expect(builder.getNode(target)).toBeNull()
    expect(builder.snapshot().children).toEqual({})
    expect(events).toEqual([])
  })

  it('does not recreate a deleted parent for its pending child', async () => {
    const parent = `${root}/folder`
    await mkdir(parent)
    await vi.waitFor(() => expect(builder.getNode(parent)).not.toBeNull(), { timeout: 4000 })
    const target = `${parent}/note.md`
    await pauseAdd(target)
    await rm(parent, { recursive: true })
    await waitForRaw('unlinkDir', parent)
    await releaseStat()
    expect(builder.getNode(target)).toBeNull()
    expect(builder.getNode(parent)).toBeNull()
    expect(builder.snapshot().children).toEqual({})
    expect(events.filter((event) => event.type === 'added').map((event) => event.path)).toEqual([parent])
  })

  it('does not repopulate a deleted root', async () => {
    const target = `${root}/note.md`
    await pauseAdd(target)
    await rm(root, { recursive: true })
    await waitForRaw('unlinkDir', root)
    await releaseStat()
    expect(builder.getNode(target)).toBeNull()
    expect(builder.snapshot().children).toEqual({})
    expect(events).toEqual([])
  })

  it.each([false, true])('does not mutate a disposed builder (async=%s)', async (asyncDispose) => {
    const target = `${root}/note.md`
    await pauseAdd(target)
    if (asyncDispose) await builder.disposeAsync()
    else builder.dispose()
    const snapshot = builder.snapshot()
    await releaseStat()
    expect(builder.getNode(target)).toBeNull()
    expect(builder.snapshot()).toEqual(snapshot)
    expect(events).toEqual([])
  })

  it('allows unrelated adds to finish while another stat is pending', async () => {
    const target = `${root}/slow.md`
    await pauseAdd(target)
    const other = `${root}/other.md`
    await writeFile(other, 'other')
    await vi.waitFor(() => expect(builder.getNode(other)?.stats).toBeDefined(), { timeout: 4000 })
    await releaseStat()
    expect(builder.getNode(target)?.stats).toBeDefined()
    expect(events.filter((event) => event.type === 'added').map((event) => event.path)).toEqual([other, target])
  })

  it('keeps the replacement file and its fresh stats when an old add completes', async () => {
    const target = `${root}/note.md`
    await pauseAdd(target)
    await rm(target)
    await waitForRaw('unlink', target)
    await writeFile(target, 'replacement')
    const modified = new Date('2020-01-01T00:00:00Z')
    await utimes(target, modified, modified)
    const expectedMtime = (await stat(target)).mtimeMs
    await vi.waitFor(() => expect(builder.getNode(target)?.stats?.mtime).toBe(expectedMtime), { timeout: 4000 })
    await releaseStat()
    expect(builder.getNode(target)?.stats?.mtime).toBe(expectedMtime)
    expect(await readFile(target, 'utf8')).toBe('replacement')
    expect(events.filter((event) => event.type === 'added').map((event) => event.path)).toEqual([target])
  })

  it('does not recreate the old directory after an explicit rename', async () => {
    const parent = `${root}/folder`
    const renamed = `${root}/renamed`
    await mkdir(parent)
    await vi.waitFor(() => expect(builder.getNode(parent)).not.toBeNull(), { timeout: 4000 })
    const target = `${parent}/note.md`
    await pauseAdd(target)
    await rename(parent, renamed)
    expect(builder.rename(parent, renamed)).toBe(true)
    await releaseStat()
    expect(builder.getNode(parent)).toBeNull()
    expect(builder.getNode(target)).toBeNull()
    await vi.waitFor(() => expect(builder.getNode(`${renamed}/note.md`)?.stats).toBeDefined(), { timeout: 4000 })
    expect(builder.root.hasChild('folder')).toBe(false)
    expect(events.filter((event) => event.type === 'added').map((event) => event.path)).toEqual([
      parent,
      `${renamed}/note.md`
    ])
  })

  it('keeps a pending destination add when unlink wins explicit rename coordination', async () => {
    const original = `${root}/original.md`
    const target = `${root}/renamed.md`
    await writeFile(original, 'retained note')
    await vi.waitFor(() => expect(builder.getNode(original)?.stats).toBeDefined(), { timeout: 4000 })
    delayedStat.path = target
    await rename(original, target)
    await waitForRaw('unlink', original)
    await vi.waitFor(() => expect(delayedStat.entered).toBe(true), { timeout: 4000 })
    expect(builder.getNode(original)).toBeNull()
    expect(builder.getNode(target)).toBeNull()
    expect(builder.rename(original, target)).toBe(false)
    await releaseStat()
    expect(builder.getNode(target)?.stats).toBeDefined()
    expect(builder.root.hasChild('original.md')).toBe(false)
    expect(builder.root.hasChild('renamed.md')).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('retained note')
    expect(events.map((event) => event.type)).toEqual(['added', 'removed', 'added'])
    expect(events.filter((event) => event.type === 'added').map((event) => event.path)).toEqual([original, target])
  })

  it('keeps a pending replacement source add when rename coordination arrives after unlink', async () => {
    const original = `${root}/original.md`
    const target = `${root}/renamed.md`
    await writeFile(original, 'renamed note')
    await vi.waitFor(() => expect(builder.getNode(original)?.stats).toBeDefined(), { timeout: 4000 })
    await rename(original, target)
    await waitForRaw('unlink', original)
    await vi.waitFor(() => expect(builder.getNode(target)?.stats).toBeDefined(), { timeout: 4000 })
    expect(builder.getNode(original)).toBeNull()
    await pauseAdd(original)
    expect(builder.getNode(original)).toBeNull()
    expect(builder.rename(original, target)).toBe(false)
    await releaseStat()
    expect(builder.getNode(original)?.stats).toBeDefined()
    expect(builder.getNode(target)?.stats).toBeDefined()
    expect(builder.root.hasChild('original.md')).toBe(true)
    expect(builder.root.hasChild('renamed.md')).toBe(true)
    expect(await readFile(original, 'utf8')).toBe('note')
    expect(await readFile(target, 'utf8')).toBe('renamed note')
    expect(events.map((event) => event.type)).toEqual(['added', 'removed', 'added', 'added'])
    expect(events.filter((event) => event.type === 'added').map((event) => event.path)).toEqual([
      original,
      target,
      original
    ])
  })
})
