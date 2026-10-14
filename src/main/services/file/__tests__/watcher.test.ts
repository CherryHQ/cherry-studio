import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileEntryId } from '@shared/data/types/file'
import type { AbsoluteFilePath } from '@shared/types/file'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { createDirectoryWatcher } = await import('../watcher')
const { danglingCache } = await import('../danglingCache')

import type { CreateDirectoryWatcherOptions, DirectoryWatcher, WatcherEvent } from '../watcher'

const waitForReady = async (w: DirectoryWatcher): Promise<void> => {
  await new Promise<void>((resolve) => {
    const off = w.onEvent((e) => {
      if (e.kind === 'ready') {
        off()
        resolve()
      }
    })
  })
  // Brief settle after `ready` — on Linux ext4 + inotify (CI runners), events
  // written in the same tick as `ready` are occasionally dropped before the
  // watcher's listener chain is fully primed. 50ms is well under the test
  // timeout and matches the chokidar settle floor.
  await new Promise((resolve) => setTimeout(resolve, 50))
}

// Default 15s: native inotify/FSEvents delivery on loaded CI runners can lag
// several seconds behind the write. A tighter per-call deadline (we had 8s on
// three positive-event waits) was the flakiest thing in the file — the sibling
// `add` test on this default passes reliably on the same runner. Keep every
// wait for an event we DO expect on this default; only absence checks use short
// fixed sleeps.
const waitForEvent = (
  w: DirectoryWatcher,
  pred: (e: WatcherEvent) => boolean,
  timeoutMs = 15_000
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
  let watchers: DirectoryWatcher[]

  const watchDirectory = (options?: CreateDirectoryWatcherOptions): DirectoryWatcher => {
    const watcher = createDirectoryWatcher(dir as AbsoluteFilePath, options)
    watchers.push(watcher)
    return watcher
  }

  beforeEach(async () => {
    watchers = []
    // Windows TEMP can use an 8.3 alias that libuv cannot match to long-path events.
    dir = await realpath(await mkdtemp(path.join(tmpdir(), 'cherry-fm-watcher-')))
    danglingCache.clear()
  })

  afterEach(async () => {
    await Promise.all(watchers.map((watcher) => watcher.close()))
    await rm(dir, { recursive: true, force: true })
  })

  it('emits "ready" after the initial scan', async () => {
    const w = watchDirectory()
    await waitForReady(w)
  })

  it('emits "add" for newly created files and writes "present" into DanglingCache', async () => {
    const target = path.join(dir, 'note.txt') as AbsoluteFilePath
    danglingCache.addEntry('e-w-add', target)

    const w = watchDirectory()
    await waitForReady(w)
    const added = waitForEvent(w, (e) => e.kind === 'add' && e.path === target)
    await writeFile(target, 'hello')
    const ev = await added
    expect(ev.kind).toBe('add')
    expect(
      await danglingCache.check({
        id: 'e-w-add' as FileEntryId,
        origin: 'external',
        externalPath: target,
        name: 'note',
        ext: 'txt',
        size: null,
        deletedAt: null,
        createdAt: 0,
        updatedAt: 0
      } as never)
    ).toBe('present')
  })

  it('emits "unlink" for removed files and writes "missing" into DanglingCache', async () => {
    const target = path.join(dir, 'gone.txt') as AbsoluteFilePath
    await writeFile(target, 'soon-to-go')
    danglingCache.addEntry('e-w-unlink', target)
    danglingCache.onFsEvent(target, 'present')

    const w = watchDirectory({ stabilityThresholdMs: 0 })
    await waitForReady(w)
    const removed = waitForEvent(w, (e) => e.kind === 'unlink' && e.path === target)
    await rm(target)
    const ev = await removed
    expect(ev.kind).toBe('unlink')
    expect(
      await danglingCache.check({
        id: 'e-w-unlink' as FileEntryId,
        origin: 'external',
        externalPath: target,
        name: 'gone',
        ext: 'txt',
        size: null,
        deletedAt: null,
        createdAt: 0,
        updatedAt: 0
      } as never)
    ).toBe('missing')
  })

  it('emits "change" when a watched file is modified in place', async () => {
    const target = path.join(dir, 'mut.txt') as AbsoluteFilePath

    // Default stabilityThresholdMs (200) keeps chokidar's event sequencing
    // deterministic across busy CI hosts; stability=0 was flaky on macOS
    // FSEvents when many tests share tmpdir traffic.
    const w = watchDirectory()
    await waitForReady(w)

    // First write registers the file (fires 'add'); second write fires 'change'.
    const added = waitForEvent(w, (e) => e.kind === 'add' && e.path === target)
    await writeFile(target, 'v1')
    await added
    // Brief settle so chokidar's awaitWriteFinish window closes on the add.
    await new Promise((r) => setTimeout(r, 250))
    const changed = waitForEvent(w, (e) => e.kind === 'change' && e.path === target)
    await writeFile(target, 'v2-content-larger')
    const ev = await changed
    expect(ev.kind).toBe('change')
  })

  it('suppresses .DS_Store events via the built-in ignore set', async () => {
    const w = watchDirectory({ stabilityThresholdMs: 0 })
    await waitForReady(w)
    const seen: WatcherEvent[] = []
    w.onEvent((e) => seen.push(e))
    await writeFile(path.join(dir, '.DS_Store'), 'noise')
    await new Promise((r) => setTimeout(r, 600))
    expect(seen.find((e) => (e.kind === 'add' || e.kind === 'change') && e.path?.endsWith('.DS_Store'))).toBeUndefined()
  })

  it('limits recursive watching to maxDepth when provided', async () => {
    const nestedDir = path.join(dir, 'nested')
    await mkdir(nestedDir)

    const w = watchDirectory({ maxDepth: 0, stabilityThresholdMs: 0 })
    await waitForReady(w)

    const seen: WatcherEvent[] = []
    const off = w.onEvent((e) => seen.push(e))

    const rootFile = path.join(dir, 'root.txt') as AbsoluteFilePath
    const nestedFile = path.join(nestedDir, 'nested.txt') as AbsoluteFilePath
    const rootAdd = waitForEvent(w, (e) => e.kind === 'add' && e.path === rootFile)
    await writeFile(rootFile, 'root')
    await rootAdd

    await writeFile(nestedFile, 'nested')
    await new Promise((r) => setTimeout(r, 400))

    expect(seen.some((e) => e.kind === 'add' && e.path === nestedFile)).toBe(false)
    off()
  })

  // On Linux ext4, filenames are opaque bytes — writeFile preserves the NFD
  // encoding verbatim and chokidar surfaces it as NFD, so we use Linux to
  // *reproduce* the byte pattern a CJK/accented file migrated from HFS+ (via
  // `rsync -E`) shows up as on a macOS user's disk. Because `externalPath` is
  // now stored byte-faithful (no NFC), the DanglingCache reverse index is
  // keyed by that exact NFD form and the watcher matches the chokidar event by
  // *raw byte equality* — the previous NFC-normalize bridge in `handle()` is
  // gone. On Linux the raw event byte-matches the stored key by construction.
  it.runIf(process.platform === 'linux')(
    'feeds DanglingCache by raw byte equality — NFD event matches the byte-faithful NFD key (no NFC step)',
    async () => {
      const nfd = 'qu\u0065\u0301.txt' // q, u, e, combining acute -> NFD
      const nfc = 'qu\u00E9.txt' // q, u, e-precomposed -> NFC
      expect(nfd).not.toBe(nfc) // byte-distinct strings reaching us at runtime

      const writtenPath = path.join(dir, nfd) as AbsoluteFilePath

      // DanglingCache's reverse index is populated by `ensureExternalEntry`,
      // whose `externalPath` is now stored byte-faithful (no NFC). Mirror that
      // by registering the entry under the exact NFD bytes on disk.
      danglingCache.addEntry('e-w-nfd', writtenPath)

      const w = watchDirectory()
      await waitForReady(w)
      const added = waitForEvent(w, (e) => e.kind === 'add' && e.path?.endsWith('.txt'), 30_000)
      await writeFile(writtenPath, 'hello')
      const ev = await added
      if (ev.kind !== 'add') throw new Error('expected add event')
      expect(ev.path).toBe(writtenPath)

      // The reverse-index key and the chokidar event path are the same
      // byte-faithful NFD string, so the lookup hits with no NFC normalization.
      expect(
        await danglingCache.check({
          id: 'e-w-nfd' as FileEntryId,
          origin: 'external',
          externalPath: writtenPath,
          name: 'qué',
          ext: 'txt',
          size: null,
          deletedAt: null,
          createdAt: 0,
          updatedAt: 0
        } as never)
      ).toBe('present')
    },
    35_000
  )

  it('close() is idempotent and stops further event delivery', async () => {
    const w = watchDirectory({ stabilityThresholdMs: 0 })
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
