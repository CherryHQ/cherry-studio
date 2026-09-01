import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Read at call time, so the `@application` instance re-created by `vi.resetModules()`
// resolves the same per-test directory as the one the static imports captured.
const tmp = vi.hoisted(() => ({ root: '' }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const { join } = await import('node:path')
  const mocked = mockApplicationFactory()
  mocked.application.getPath.mockImplementation((key: string, filename?: string) =>
    filename ? join(tmp.root, key, filename) : join(tmp.root, key)
  )
  return mocked
})

import { miniAppStorageFile } from '../../paths'
import { MINI_APP_STORAGE_MAX_BYTES } from '../storageFile'

const APP = 'com.example.a'

describe('mini app storage file', () => {
  beforeEach(() => {
    tmp.root = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-storage-'))
    vi.resetModules()
  })

  afterEach(() => {
    fs.rmSync(tmp.root, { recursive: true, force: true })
  })

  it('round-trips through the file, not memory', async () => {
    const { writeStorage } = await import('../storageFile')
    writeStorage(APP, { slot1: 'saved' })
    vi.resetModules()
    const { readStorage } = await import('../storageFile')
    expect(readStorage(APP)).toEqual({ slot1: 'saved' })
  })

  it('treats a corrupt file as empty instead of throwing', async () => {
    const { readStorage, writeStorage } = await import('../storageFile')
    writeStorage(APP, { a: '1' })
    fs.writeFileSync(miniAppStorageFile(APP), '{ not json')
    expect(readStorage(APP)).toEqual({})
  })

  it('rejects a write that would exceed the total cap', async () => {
    // Same module graph as the implementation: after `vi.resetModules()` a statically
    // imported class is a different identity and `toThrow(Class)` would be false.
    const { writeStorage } = await import('../storageFile')
    const { QuotaExceededError } = await import('../quota')
    const big = 'x'.repeat(MINI_APP_STORAGE_MAX_BYTES)
    expect(() => writeStorage(APP, { k: big })).toThrow(QuotaExceededError)
  })

  it('leaves the previous contents intact when a write is rejected', async () => {
    const { readStorage, writeStorage } = await import('../storageFile')
    writeStorage(APP, { keep: 'me' })
    try {
      writeStorage(APP, { keep: 'me', huge: 'x'.repeat(MINI_APP_STORAGE_MAX_BYTES) })
    } catch {}
    // The bug this guards: checking the cap after the write, or writing the temp file
    // over the real one before checking. Either way the save is gone.
    expect(readStorage(APP)).toEqual({ keep: 'me' })
  })

  it('refuses to answer "empty" when the save file cannot be READ', async () => {
    // The bug: `set` is a read-modify-write and `writeStorage` renames atomically, so a
    // read failure answered as `{}` does not degrade the save — it replaces it with the
    // single key being written, permanently and successfully. A directory in the file's
    // place is the portable way to make the read fail for a reason that is not ENOENT.
    const { readStorage } = await import('../storageFile')
    const { MiniAppUnavailableError } = await import('../../errors')
    fs.mkdirSync(miniAppStorageFile(APP), { recursive: true })

    // `Unavailable`, not the `Internal` a bare fs error would become: this is transient and
    // an app can back off, which it cannot do behind a name that means "the host is broken".
    expect(() => readStorage(APP)).toThrow(MiniAppUnavailableError)
  })

  it('still starts over when the file is READ but unparseable', async () => {
    // The other half, and the reason this is a triage rather than a blanket throw: bytes
    // that parse into nothing are already unusable, so refusing to start would strand the
    // app for good over damage that has already happened.
    const { readStorage } = await import('../storageFile')
    fs.mkdirSync(path.dirname(miniAppStorageFile(APP)), { recursive: true })
    fs.writeFileSync(miniAppStorageFile(APP), '{ not json', 'utf8')

    expect(readStorage(APP)).toEqual({})
  })

  // Real permissions, because ESM refuses `vi.spyOn(fs, 'statSync')`. Skipped where a
  // mode-000 directory does not actually deny: Windows ignores the bits, root bypasses them.
  const deniesByMode = process.platform !== 'win32' && process.getuid?.() !== 0
  it.skipIf(!deniesByMode)('still answers when even the file’s SIZE cannot be read', async () => {
    // The fallback read the size with `statSync(..., { throwIfNoEntry: false })`, and that
    // option suppresses "no entry" ALONE — measured: it swallows ENOENT and ENOTDIR but
    // rethrows EACCES, which is exactly the failure that lands execution in this branch. So
    // the fallback threw back out in the one case it exists for, taking down the only screen
    // that can clear the data.
    const { storageUsage } = await import('../storageFile')
    const dir = path.dirname(miniAppStorageFile(APP))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(miniAppStorageFile(APP), '{"a":"b"}', 'utf8')
    fs.chmodSync(dir, 0o000)

    try {
      expect(storageUsage(APP)).toMatchObject({ bytes: 0, count: 0 })
    } finally {
      fs.chmodSync(dir, 0o755)
    }
  })

  it('counts keys as well as values', async () => {
    const { writeStorage, storageUsage } = await import('../storageFile')
    writeStorage(APP, { 'a-long-key-name': 'v' })
    // Serialized bytes, so the key is inside the number. Counting only values would
    // let a thousand long keys sit outside the quota while `usage()` reads near zero.
    expect(storageUsage(APP).bytes).toBeGreaterThan('v'.length + 'a-long-key-name'.length)
  })
})
