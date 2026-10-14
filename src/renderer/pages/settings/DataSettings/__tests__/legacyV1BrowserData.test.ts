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
  beginLegacyV1Cleanup,
  clearLegacyV1BrowserData,
  finalizeLegacyV1Cleanup,
  hasLegacyV1Marker,
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
    get: vi.fn(async (key: string) => rowsById.get(key)),
    orderBy: vi.fn(() => createCollection()),
    pageQuery,
    where: vi.fn(() => ({ above: (key: string) => createCollection(key) }))
  }
}

function installDeleteDatabase() {
  const request = {
    error: null as DOMException | null,
    onsuccess: null as (() => void) | null,
    onblocked: null as (() => void) | null,
    onerror: null as (() => void) | null
  }
  const deleteDatabase = vi.fn(() => request)
  vi.stubGlobal('indexedDB', { deleteDatabase })
  return {
    block: () => request.onblocked?.(),
    deleteDatabase,
    fail: () => {
      request.error = new DOMException('delete failed')
      request.onerror?.()
    },
    succeed: () => request.onsuccess?.()
  }
}

describe('legacyV1BrowserData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    dexieMock.exists.mockResolvedValue(true)
    dexieMock.tableNames.splice(0, dexieMock.tableNames.length, 'message_blocks')
  })

  it('uses persisted v1 state or an incomplete cleanup as the visibility marker', () => {
    localStorage.setItem('language', 'zh-cn')
    expect(hasLegacyV1Marker()).toBe(false)

    localStorage.setItem('persist:cherry-studio', '')
    expect(hasLegacyV1Marker()).toBe(true)

    localStorage.removeItem('persist:cherry-studio')
    expect(beginLegacyV1Cleanup()).toBe(true)
    expect(hasLegacyV1Marker()).toBe(true)
  })

  it('reports a retry-marker write failure without throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })

    expect(beginLegacyV1Cleanup()).toBe(false)
  })

  it('estimates selected localStorage keys and every IndexedDB page', async () => {
    localStorage.setItem('persist:cherry-studio', 'legacy')
    localStorage.setItem('failed_favicon_https://example.com', 'active-v2-state')
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
      rows.reduce((total, row) => total + encoder.encode(JSON.stringify(row)).byteLength, 0)

    expect(result).toMatchObject({
      bytes: expectedBytes,
      accuracy: 'estimated',
      completeness: 'complete'
    })
    expect(table.pageQuery).toHaveBeenCalledTimes(4)
    expect(table.get).toHaveBeenCalledTimes(rows.length)
    expect(dexieMock.close).toHaveBeenCalledOnce()
  })

  it('cancels an in-flight IndexedDB inspection and closes the database', async () => {
    const table = createTableMock([{ id: 'block-001', payload: 'legacy' }])
    let releaseGet!: () => void
    table.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseGet = () => resolve({ id: 'block-001', payload: 'legacy' })
        })
    )
    dexieMock.table.mockReturnValue(table)
    const controller = new AbortController()

    const inspection = inspectLegacyV1BrowserData(controller.signal)
    await vi.waitFor(() => expect(table.get).toHaveBeenCalledOnce())
    controller.abort()
    releaseGet()

    await expect(inspection).rejects.toMatchObject({ name: 'AbortError' })
    expect(dexieMock.close).toHaveBeenCalledOnce()
  })

  it('keeps known bytes and reports partial size when one IndexedDB table cannot be serialized', async () => {
    localStorage.setItem('language', 'zh-cn')
    dexieMock.table.mockReturnValue(createTableMock([{ id: 'bad', payload: 1n }]))

    const result = await inspectLegacyV1BrowserData()

    expect(result.bytes).toBeGreaterThan(0)
    expect(result.completeness).toBe('partial')
  })

  it('deletes only the v1 keys and the CherryStudio database', async () => {
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
    const deleteRequest = installDeleteDatabase()

    const cleanup = clearLegacyV1BrowserData()
    await vi.waitFor(() => expect(deleteRequest.deleteDatabase).toHaveBeenCalledWith('CherryStudio'))
    deleteRequest.succeed()
    const result = await cleanup

    expect(result).toEqual({ group: 'legacy_v1', status: 'cleared' })
    for (const key of LEGACY_LOCAL_STORAGE_KEYS) {
      expect(localStorage.getItem(key)).toBeNull()
    }
    for (const key of failedFaviconKeys) expect(localStorage.getItem(key)).toBe('true')
    expect(localStorage.getItem('cs_cache_persist')).toBe('keep-cache')
    expect(localStorage.getItem('modelscope_token')).toBe('keep-token')
    expect(localStorage.getItem('failed-favicon-unrelated')).toBe('keep-unrelated')
  })

  it('treats blocked as an intermediate event and waits for IndexedDB deletion success', async () => {
    localStorage.setItem('language', 'zh-cn')
    const deleteRequest = installDeleteDatabase()
    const onBlocked = vi.fn()
    let settled = false

    const cleanup = clearLegacyV1BrowserData(onBlocked).finally(() => {
      settled = true
    })
    await vi.waitFor(() => expect(deleteRequest.deleteDatabase).toHaveBeenCalledOnce())
    deleteRequest.block()
    await Promise.resolve()

    expect(onBlocked).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    expect(localStorage.getItem('language')).toBeNull()

    deleteRequest.succeed()
    await expect(cleanup).resolves.toEqual({ group: 'legacy_v1', status: 'cleared' })
  })

  it('waits through blocked and returns failed only after IndexedDB deletion errors', async () => {
    const deleteRequest = installDeleteDatabase()
    const onBlocked = vi.fn()

    const cleanup = clearLegacyV1BrowserData(onBlocked)
    await vi.waitFor(() => expect(deleteRequest.deleteDatabase).toHaveBeenCalledOnce())
    deleteRequest.block()
    deleteRequest.fail()

    expect(onBlocked).toHaveBeenCalledOnce()
    await expect(cleanup).resolves.toEqual({ group: 'legacy_v1', status: 'failed' })
  })

  it('merges browser and main-process v1 cleanup into one partial result', () => {
    const result = mergeLegacyV1CleanupResults(
      {
        group: 'legacy_v1',
        status: 'cleared'
      },
      {
        group: 'legacy_v1',
        status: 'partial'
      }
    )

    expect(result).toEqual({
      group: 'legacy_v1',
      status: 'partial'
    })
  })

  it('keeps the retry marker after a partial run and clears it after a successful retry', async () => {
    localStorage.setItem('persist:cherry-studio', 'legacy')
    beginLegacyV1Cleanup()
    const deleteRequest = installDeleteDatabase()

    const browserCleanup = clearLegacyV1BrowserData()
    await vi.waitFor(() => expect(deleteRequest.deleteDatabase).toHaveBeenCalledOnce())
    deleteRequest.succeed()
    const partialResult = finalizeLegacyV1Cleanup(
      mergeLegacyV1CleanupResults({ group: 'legacy_v1', status: 'failed' }, await browserCleanup)
    )

    expect(partialResult.status).toBe('partial')
    expect(localStorage.getItem('persist:cherry-studio')).toBeNull()
    expect(hasLegacyV1Marker()).toBe(true)

    dexieMock.exists.mockResolvedValue(false)
    const retryResult = finalizeLegacyV1Cleanup(
      mergeLegacyV1CleanupResults({ group: 'legacy_v1', status: 'not_found' }, await clearLegacyV1BrowserData())
    )

    expect(retryResult.status).toBe('not_found')
    expect(hasLegacyV1Marker()).toBe(false)
  })
})
