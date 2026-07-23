import { MigrationIpcChannels } from '@shared/data/migration/v2/types'
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
      return dexieMock.tableNames.map((name) => ({ name }))
    }

    open = dexieMock.open
    close = dexieMock.close
    table = dexieMock.table
  }
}))

import { DexieExporter } from '../DexieExporter'

const invoke = vi.fn()
const EXPORT_CHUNK_CHAR_LIMIT = 1024 * 1024
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u

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
    toArray: vi.fn(async () => rows),
    where: vi.fn(() => ({ above: (key: string) => createCollection(key) }))
  }
}

function exportedText(): string {
  return invoke.mock.calls
    .filter(([channel]) => channel === MigrationIpcChannels.WriteExportFile)
    .map(([, , , chunk]) => chunk)
    .join('')
}

describe('DexieExporter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dexieMock.tableNames.splice(0, dexieMock.tableNames.length, 'message_blocks')
    dexieMock.exists.mockResolvedValue(true)
    invoke.mockResolvedValue(true)
    ;(window as unknown as { electron: { ipcRenderer: { invoke: typeof invoke } } }).electron = {
      ipcRenderer: { invoke }
    }
  })

  it('exports a large table through primary-key pages as one valid JSON array', async () => {
    const rows = Array.from({ length: 205 }, (_, index) => ({
      id: `block-${String(index).padStart(3, '0')}`,
      payload: `payload-${index}`
    }))
    const table = createTableMock(rows)
    dexieMock.table.mockReturnValue(table)

    await new DexieExporter('/export').exportAll()

    expect(JSON.parse(exportedText())).toEqual(rows)
    expect(table.toArray).not.toHaveBeenCalled()
    expect(table.pageQuery).toHaveBeenCalledTimes(4)
    const writeCalls = invoke.mock.calls.filter(([channel]) => channel === MigrationIpcChannels.WriteExportFile)
    expect(writeCalls[0]?.[4]).toBe('overwrite')
    expect(writeCalls.slice(1).every((call) => call[4] === 'append')).toBe(true)
    expect(dexieMock.close).toHaveBeenCalledOnce()
  })

  it('flushes bounded chunks while preserving the JSON array', async () => {
    const rows = [
      { id: 'block-1', payload: 'a'.repeat(600 * 1024) },
      { id: 'block-2', payload: 'b'.repeat(600 * 1024) }
    ]
    dexieMock.table.mockReturnValue(createTableMock(rows))

    await new DexieExporter('/export').exportAll()

    const writeCalls = invoke.mock.calls.filter(([channel]) => channel === MigrationIpcChannels.WriteExportFile)
    expect(
      writeCalls.map(([, , , chunk]) => String(chunk).length).every((length) => length <= EXPORT_CHUNK_CHAR_LIMIT)
    ).toBe(true)
    expect(JSON.parse(exportedText())).toEqual(rows)
  })

  it('safely splits a single record larger than the export chunk limit', async () => {
    const serializedPrefix = JSON.stringify({ id: 'block-1', payload: '' }).slice(0, -2)
    const row = {
      id: 'block-1',
      payload: `${'a'.repeat(EXPORT_CHUNK_CHAR_LIMIT - serializedPrefix.length - 1)}😀tail`
    }
    dexieMock.table.mockReturnValue(createTableMock([row]))

    await new DexieExporter('/export').exportAll()

    const writeCalls = invoke.mock.calls.filter(([channel]) => channel === MigrationIpcChannels.WriteExportFile)
    const chunks = writeCalls.map(([, , , chunk]) => String(chunk))
    expect(chunks.every((chunk) => chunk.length <= EXPORT_CHUNK_CHAR_LIMIT)).toBe(true)
    expect(chunks.every((chunk) => !LONE_SURROGATE.test(chunk))).toBe(true)
    expect(writeCalls[0]?.[4]).toBe('overwrite')
    expect(writeCalls.slice(1).every((call) => call[4] === 'append')).toBe(true)
    expect(JSON.parse(chunks.join(''))).toEqual([row])
  })

  it('exports an empty table as an empty JSON array', async () => {
    dexieMock.table.mockReturnValue(createTableMock([]))

    await new DexieExporter('/export').exportAll()

    expect(exportedText()).toBe('[]')
    const writeCalls = invoke.mock.calls.filter(([channel]) => channel === MigrationIpcChannels.WriteExportFile)
    expect(writeCalls[0]?.[4]).toBe('overwrite')
    expect(writeCalls[1]?.[4]).toBe('append')
  })

  it('closes the database when appending a chunk fails', async () => {
    dexieMock.table.mockReturnValue(createTableMock([{ id: 'block-1' }]))
    invoke.mockImplementation((_channel, _exportPath, _tableName, _chunk, writeMode) =>
      writeMode === 'append' ? Promise.reject(new Error('disk full')) : Promise.resolve(true)
    )

    await expect(new DexieExporter('/export').exportAll()).rejects.toThrow('disk full')
    expect(dexieMock.close).toHaveBeenCalledOnce()
  })

  it('adds table and primary-key context to serialization failures without leaking record data', async () => {
    const table = createTableMock([{ id: 'block-secret', payload: 1n, secret: 'do-not-leak' }])
    dexieMock.table.mockReturnValue(table)

    let thrown: unknown
    try {
      await new DexieExporter('/export').exportAll()
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain(
      'Failed to export Dexie table "message_blocks" at primary key "block-secret"'
    )
    expect((thrown as Error).message).not.toContain('do-not-leak')
  })

  it('fails instead of silently dropping a record missing from bulkGet', async () => {
    const table = createTableMock([{ id: 'block-1' }])
    table.bulkGet.mockResolvedValueOnce([undefined])
    dexieMock.table.mockReturnValue(table)

    await expect(new DexieExporter('/export').exportAll()).rejects.toThrow(
      'Failed to export Dexie table "message_blocks" at primary key "block-1"'
    )
  })
})
