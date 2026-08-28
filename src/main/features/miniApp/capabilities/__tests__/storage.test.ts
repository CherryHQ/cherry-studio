import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { miniAppTable } from '@data/db/schemas/miniApp'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MINI_APP_QUOTAS, QuotaExceededError, RateLimitedError } from '../quota'
import { storageCapability } from '../storage'
import { writeStorage } from '../storageFile'

const A = 'com.example.a'
const B = 'com.example.b'

describe('cherry.storage', () => {
  const dbh = setupTestDatabase()
  let root = ''

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-storage-cap-'))
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) =>
      filename ? path.join(root, key, filename) : path.join(root, key)
    )
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  const insertApp = (appId: string) =>
    dbh.db
      .insert(miniAppTable)
      .values({
        appId,
        kind: 'app',
        presetMiniAppId: null,
        name: appId,
        url: `cherry-miniapp://${appId}/index.html`,
        status: 'enabled',
        orderKey: 'a0'
      })
      .run()

  it('round-trips a value', () => {
    insertApp(A)
    storageCapability.set(A, { key: 'save', value: 'lvl-3' })
    expect(storageCapability.get(A, { key: 'save' })).toEqual({ value: 'lvl-3' })
  })

  it('returns null for a missing key', () => {
    insertApp(A)
    expect(storageCapability.get(A, { key: 'nope' })).toEqual({ value: null })
  })

  it('isolates apps sharing a key name', () => {
    insertApp(A)
    insertApp(B)
    storageCapability.set(A, { key: 'save', value: 'mine' })
    expect(storageCapability.get(B, { key: 'save' })).toEqual({ value: null })
  })

  it('overwrites rather than duplicating', () => {
    insertApp(A)
    storageCapability.set(A, { key: 'save', value: 'one' })
    storageCapability.set(A, { key: 'save', value: 'two' })
    expect(storageCapability.get(A, { key: 'save' })).toEqual({ value: 'two' })
    expect(storageCapability.usage(A)).toMatchObject({ count: 1 })
  })

  it('deletes a key', () => {
    insertApp(A)
    storageCapability.set(A, { key: 'save', value: 'one' })
    storageCapability.delete(A, { key: 'save' })
    expect(storageCapability.get(A, { key: 'save' })).toEqual({ value: null })
  })

  it('lists its own keys only', () => {
    insertApp(A)
    insertApp(B)
    storageCapability.set(A, { key: 'k1', value: 'x' })
    storageCapability.set(A, { key: 'k2', value: 'x' })
    storageCapability.set(B, { key: 'other', value: 'x' })
    expect(storageCapability.keys(A)).toEqual({ keys: ['k1', 'k2'] })
  })

  it('reports usage against the quota', () => {
    insertApp(A)
    storageCapability.set(A, { key: 'k', value: 'abcde' })
    // Serialized bytes of `{"k":"abcde"}` — keys count too (design §6.2, Task 6 contract).
    expect(storageCapability.usage(A)).toEqual({
      bytes: 13,
      count: 1,
      bytesLimit: MINI_APP_QUOTAS.storage.bytes,
      countLimit: MINI_APP_QUOTAS.storage.count
    })
  })

  it('throws QuotaExceededError past the entry count', () => {
    insertApp(A)
    // Seed below the capability so the write-rate limiter (20/s) cannot mask the capacity check.
    writeStorage(A, Object.fromEntries(Array.from({ length: MINI_APP_QUOTAS.storage.count }, (_, i) => [`k${i}`, 'x'])))
    let err: unknown
    try {
      storageCapability.set(A, { key: 'one-too-many', value: 'x' })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(QuotaExceededError)
    expect(err).not.toBeInstanceOf(RateLimitedError)
  })

  it('rejects a non-string value', () => {
    insertApp(A)
    expect(() => storageCapability.set(A, { key: 'k', value: 42 })).toThrow()
  })
})
