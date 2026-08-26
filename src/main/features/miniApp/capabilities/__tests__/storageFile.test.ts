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

  it('counts keys as well as values', async () => {
    const { writeStorage, storageUsage } = await import('../storageFile')
    writeStorage(APP, { 'a-long-key-name': 'v' })
    // Serialized bytes, so the key is inside the number. Counting only values would
    // let a thousand long keys sit outside the quota while `usage()` reads near zero.
    expect(storageUsage(APP).bytes).toBeGreaterThan('v'.length + 'a-long-key-name'.length)
  })
})
