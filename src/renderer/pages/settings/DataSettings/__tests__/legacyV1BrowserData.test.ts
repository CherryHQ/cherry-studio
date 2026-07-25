import { beforeEach, describe, expect, it, vi } from 'vitest'

interface LegacyRecord {
  id: string
  [key: string]: unknown
}

const dexieMock = vi.hoisted(() => ({
  close: vi.fn(),
  exists: vi.fn(),
  open: vi.fn(),
  table: vi.fn(),
  tableNames: [] as string[]
}))

vi.mock('dexie', () => ({
  Dexie: class MockDexie {
    static exists = dexieMock.exists

    get tables() {
      return dexieMock.tableNames.map((name) => ({ name, ...dexieMock.table(name) }))
    }

    open = dexieMock.open
    close = dexieMock.close
  }
}))

import {
  clearLegacyV1BrowserData,
  inspectLegacyV1BrowserData,
  LEGACY_LOCAL_STORAGE_KEYS,
  mergeLegacyV1CleanupResults
} from '../legacyV1BrowserData'

function createTableMock(inputRows: LegacyRecord[]) {
  const rows = [...inputRows].sort((a, b) => a.id.localeCompare(b.id))
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const pageQuery = vi.fn()

  const createCollection = (lastPrimaryKey?: string) => ({
    limit: (limit: number) => ({
      primaryKeys: async () => {
        pageQuery()
        return rows
          .filter((row) => lastPrimaryKey === undefined || row.id > lastPrimaryKey)
          .slice(0, limit)
          .map((row) => row.id)
      }
    })
  })

  return {
    bulkGet: vi.fn(async (keys: string[]) => keys.map((key) => rowsById.get(key))),
    orderBy: vi.fn(() => createCollection()),
    pageQuery,
    where: vi.fn(() => ({ above: (key: string) => createCollection(key) }))
  }
}

function installDeleteDatabase(result: 'success' | 'blocked' | 'error') {
  const deleteDatabase = vi.fn(() => {
    const request: {
      onsuccess: (() => void) | null
      onblocked: (() => void) | null
      onerror: (() => void) | null
    } = {
      onsuccess: null,
      onblocked: null,
      onerror: null
    }
    queueMicrotask(() => {
      if (result === 'success') request.onsuccess?.()
      else if (result === 'blocked') request.onblocked?.()
      else request.onerror?.()
    })
    return request
  })
  vi.stubGlobal('indexedDB', { deleteDatabase })
  return deleteDatabase
}

describe('legacyV1BrowserData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    dexieMock.exists.mockResolvedValue(true)
    dexieMock.tableNames.splice(0, dexieMock.tableNames.length, 'message_blocks')
  })

  it('estimates selected localStorage keys and every IndexedDB page', async () => {
    localStorage.setItem('persist:cherry-studio', 'legacy')
    localStorage.setItem('failed_favicon_https://example.com', 'true')
    localStorage.setItem('cs_cache_persist', 'v2-cache')
    const rows = Array.from({ length: 205 }, (_, index) => ({
      id: `block-${String(index).padStart(3, '0')}`,
      payload: `payload-${index}`
    }))
    const table = createTableMock(rows)
    dexieMock.table.mockReturnValue(table)

    const result = await inspectLegacyV1BrowserData()
    const encoder = new TextEncoder()
    const expectedBytes =
      encoder.encode('persist:cherry-studio').byteLength +
      encoder.encode('legacy').byteLength +
      encoder.encode('failed_favicon_https://example.com').byteLength +
      encoder.encode('true').byteLength +
      rows.reduce((total, row) => total + encoder.encode(JSON.stringify(row)).byteLength, 0)

    expect(result).toMatchObject({
      bytes: expectedBytes,
      accuracy: 'estimated',
      completeness: 'complete'
    })
    expect(table.pageQuery).toHaveBeenCalledTimes(4)
    expect(dexieMock.close).toHaveBeenCalledOnce()
  })

  it('keeps known bytes and reports partial size when one IndexedDB table cannot be serialized', async () => {
    localStorage.setItem('language', 'zh-cn')
    dexieMock.table.mockReturnValue(createTableMock([{ id: 'bad', payload: 1n }]))

    const result = await inspectLegacyV1BrowserData()

    expect(result.bytes).toBeGreaterThan(0)
    expect(result.completeness).toBe('partial')
    expect(result.issues).toContainEqual({
      item: 'indexeddb:CherryStudio:message_blocks',
      code: 'inspection_failed'
    })
  })

  it('deletes only the v1 keys, failed favicon entries, and the CherryStudio database', async () => {
    for (const key of LEGACY_LOCAL_STORAGE_KEYS) {
      localStorage.setItem(key, `legacy-${key}`)
    }
    const failedFaviconKeys = ['failed_favicon_https://example.com', 'failed_favicon_app://miniapp']
    for (const key of failedFaviconKeys) {
      localStorage.setItem(key, 'true')
    }
    localStorage.setItem('cs_cache_persist', 'keep-cache')
    localStorage.setItem('modelscope_token', 'keep-token')
    localStorage.setItem('failed-favicon-unrelated', 'keep-unrelated')
    const deleteDatabase = installDeleteDatabase('success')

    const result = await clearLegacyV1BrowserData()

    expect(result).toEqual({ group: 'legacy_v1', status: 'cleared', issues: [] })
    for (const key of LEGACY_LOCAL_STORAGE_KEYS) {
      expect(localStorage.getItem(key)).toBeNull()
    }
    for (const key of failedFaviconKeys) {
      expect(localStorage.getItem(key)).toBeNull()
    }
    expect(localStorage.getItem('cs_cache_persist')).toBe('keep-cache')
    expect(localStorage.getItem('modelscope_token')).toBe('keep-token')
    expect(localStorage.getItem('failed-favicon-unrelated')).toBe('keep-unrelated')
    expect(deleteDatabase).toHaveBeenCalledWith('CherryStudio')
  })

  it('returns a partial result when IndexedDB deletion is blocked', async () => {
    localStorage.setItem('language', 'zh-cn')
    installDeleteDatabase('blocked')

    const result = await clearLegacyV1BrowserData()

    expect(result.status).toBe('partial')
    expect(result.issues).toContainEqual({
      item: 'indexeddb:CherryStudio',
      code: 'indexeddb_blocked'
    })
    expect(localStorage.getItem('language')).toBeNull()
  })

  it('returns a failed result when the only existing browser target cannot be deleted', async () => {
    installDeleteDatabase('error')

    const result = await clearLegacyV1BrowserData()

    expect(result).toEqual({
      group: 'legacy_v1',
      status: 'failed',
      issues: [{ item: 'indexeddb:CherryStudio', code: 'operation_failed' }]
    })
  })

  it('merges browser and main-process v1 cleanup into one partial result', () => {
    const result = mergeLegacyV1CleanupResults(
      {
        group: 'legacy_v1',
        status: 'cleared',
        issues: []
      },
      {
        group: 'legacy_v1',
        status: 'partial',
        issues: [{ item: 'indexeddb:CherryStudio', code: 'indexeddb_blocked' }]
      }
    )

    expect(result).toEqual({
      group: 'legacy_v1',
      status: 'partial',
      issues: [{ item: 'indexeddb:CherryStudio', code: 'indexeddb_blocked' }]
    })
  })
})
