import { describe, expect, it } from 'vitest'

import {
  clearPreviewStores,
  previewFileDelete,
  previewFileList,
  previewFileLoad,
  previewFileSave,
  previewFileUsage,
  previewStorageUsage,
  readPreviewStorage,
  writePreviewStorage
} from '../previewStores'
import { MINI_APP_QUOTAS, QuotaExceededError } from '../quota'

const R = 'preview-00000000-0000-0000-0000-000000000000'

describe('preview storage backend', () => {
  it('round-trips and isolates runtimes', () => {
    writePreviewStorage(R, { save: 'lvl-3' })
    expect(readPreviewStorage(R)).toEqual({ save: 'lvl-3' })
    expect(readPreviewStorage('preview-other')).toEqual({})
    clearPreviewStores(R)
  })

  it('refuses a map over the byte cap and keeps the previous state', () => {
    writePreviewStorage(R, { keep: 'me' })
    const big = 'x'.repeat(1024 * 1024)
    expect(() => writePreviewStorage(R, { big })).toThrow(QuotaExceededError)
    expect(readPreviewStorage(R)).toEqual({ keep: 'me' })
    clearPreviewStores(R)
  })

  it('reports usage against the same limits as the disk backend', () => {
    writePreviewStorage(R, { a: '1', b: '2' })
    const usage = previewStorageUsage(R)
    expect(usage.count).toBe(2)
    expect(usage.bytes).toBe(Buffer.byteLength(JSON.stringify({ a: '1', b: '2' }), 'utf8'))
    expect(usage.bytesLimit).toBe(MINI_APP_QUOTAS.storage.bytes)
    clearPreviewStores(R)
  })
})

describe('preview file backend', () => {
  it('round-trips save, load, list and delete', () => {
    previewFileSave(R, 'asset.bin', Buffer.from('hello'))
    expect(previewFileLoad(R, 'asset.bin')?.toString()).toBe('hello')
    expect(previewFileList(R)).toEqual(['asset.bin'])
    previewFileDelete(R, 'asset.bin')
    expect(previewFileLoad(R, 'asset.bin')).toBeNull()
    expect(previewFileUsage(R)).toEqual({ bytes: 0, count: 0 })
  })

  it('accounts a replace as a swap, not an add', () => {
    previewFileSave(R, 'state', Buffer.alloc(100))
    previewFileSave(R, 'state', Buffer.alloc(150))
    expect(previewFileUsage(R)).toEqual({ bytes: 150, count: 1 })
    clearPreviewStores(R)
  })

  it('enforces the single-entry cap', () => {
    expect(() => previewFileSave(R, 'huge', Buffer.alloc(MINI_APP_QUOTAS.file.single + 1))).toThrow(QuotaExceededError)
    expect(previewFileUsage(R)).toEqual({ bytes: 0, count: 0 })
  })

  it('enforces the total budget across saves', () => {
    // 8 MB stays under the per-entry cap, so only the cumulative budget can refuse
    // the third save.
    const chunk = 8 * 1024 * 1024
    previewFileSave(R, 'one', Buffer.alloc(chunk))
    previewFileSave(R, 'two', Buffer.alloc(chunk))
    expect(() => previewFileSave(R, 'three', Buffer.alloc(chunk))).toThrow(QuotaExceededError)
    expect(previewFileList(R)).toEqual(['one', 'two'])
    clearPreviewStores(R)
  })

  it('drops everything on clear', () => {
    previewFileSave(R, 'asset', Buffer.from('x'))
    writePreviewStorage(R, { k: 'v' })
    clearPreviewStores(R)
    expect(previewFileUsage(R)).toEqual({ bytes: 0, count: 0 })
    expect(readPreviewStorage(R)).toEqual({})
  })
})
