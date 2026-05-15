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

  // Reverse-direction skip from the NFD test in entry/create.test.ts:
  // chokidar emits whatever the OS hands it. On macOS APFS / Windows NTFS the
  // FS normalizes to NFC at storage time, so even a file we name with NFD
  // bytes gets surfaced as NFC and the case under test (chokidar firing NFD)
  // can't be set up locally. On Linux ext4, filenames are opaque bytes —
  // writeFile preserves the NFD encoding verbatim, chokidar surfaces it as
  // NFD, which is exactly the scenario the production fix targets (a CJK
  // file migrated from HFS+ via `rsync -E` arrives in NFD on macOS users'
  // disks; we use Linux to *reproduce* that byte pattern under test).
  it.runIf(process.platform === 'linux')(
    'normalizes NFD chokidar paths to NFC before feeding DanglingCache (linux-reproducible regression)',
    async () => {
      const nfd = 'qu\u0065\u0301.txt' // q, u, e, combining acute -> NFD
      const nfc = 'qu\u00E9.txt' // q, u, e-precomposed -> NFC
      expect(nfd).not.toBe(nfc) // byte-distinct strings reaching us at runtime

      const writtenPath = path.join(dir, nfd) as FilePath
      const canonicalPath = path.join(dir, nfc) as FilePath

      // DanglingCache's reverse index is populated by `ensureExternalEntry` →
      // `canonicalizeExternalPath` which already lands NFC. Mirror that here.
      danglingCache.addEntry('e-w-nfd' as FileEntryId, canonicalPath)

      const w = createDirectoryWatcher(dir as FilePath, { stabilityThresholdMs: 0 })
      await waitForReady(w)
      // Brief settle after `ready` — on Linux ext4 + inotify, events written
      // in the same tick as `ready` are occasionally dropped before the
      // watcher's listener chain is fully primed, causing the 5s `waitForEvent`
      // budget to expire on slow CI runners. 50ms is well under the default
      // CI test timeout and matches the chokidar settle floor.
      await new Promise((resolve) => setTimeout(resolve, 50))
      await writeFile(writtenPath, 'hello')
      // The emitted event still carries the raw OS path (NFD) — the cache leg
      // alone is normalized, so external subscribers see what the FS sees.
      // Extra budget (30s vs default 5s) absorbs CI runner stalls; the test
      // itself completes in milliseconds on a hot path.
      const ev = await waitForEvent(w, (e) => e.kind === 'add' && e.path?.endsWith('.txt'), 30_000)
      if (ev.kind !== 'add') throw new Error('expected add event')
      expect(ev.path).toBe(writtenPath)

      // The cache lookup uses NFC keys; without the NFC-normalize step in
      // `handle()` this would miss and the cache would stay 'unknown'.
      expect(
        await danglingCache.check({
          id: 'e-w-nfd' as FileEntryId,
          origin: 'external',
          externalPath: canonicalPath,
          name: 'qué',
          ext: 'txt',
          size: null,
          trashedAt: null,
          createdAt: 0,
          updatedAt: 0
        } as never)
      ).toBe('present')
      await w.close()
    }
  )

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
