import { MigrationIpcChannels } from '@shared/data/migration/v2/types'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
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
const loggerWarn = vi.spyOn(mockRendererLoggerService, 'warn').mockImplementation(() => undefined)

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
  const primaryKeys = vi.fn(async (lastPrimaryKey: string | undefined, limit: number) => {
    pageQuery()
    return rows
      .filter((row) => lastPrimaryKey === undefined || row.id > lastPrimaryKey)
      .slice(0, limit)
      .map((row) => row.id)
  })

  const createCollection = (lastPrimaryKey?: string) => ({
    limit: (limit: number) => ({
      primaryKeys: () => primaryKeys(lastPrimaryKey, limit)
    })
  })

  return {
    bulkGet: vi.fn(async (keys: string[]) => keys.map((key) => rowsById.get(key))),
    get: vi.fn(async (key: string) => rowsById.get(key)),
    orderBy: vi.fn(() => createCollection()),
    pageQuery,
    primaryKeys,
    toArray: vi.fn(async () => rows),
    where: vi.fn(() => ({ above: (key: string) => createCollection(key) }))
  }
}

function exportedText(): string {
  let text = ''
  for (const [channel, , , chunk, writeMode = 'overwrite'] of invoke.mock.calls) {
    if (channel !== MigrationIpcChannels.WriteExportFile) continue
    text = writeMode === 'append' ? `${text}${chunk}` : String(chunk)
  }
  return text
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

  it('skips only irrecoverable records when a bulk page read fails', async () => {
    const rows = [{ id: 'block-1' }, { id: 'block-2' }, { id: 'block-3' }]
    const table = createTableMock(rows)
    const dataLoss = new DOMException(
      'Data lost due to missing file. Affected record should be considered irrecoverable',
      'NotReadableError'
    )
    table.bulkGet.mockRejectedValueOnce(new Error('Dexie read failed', { cause: dataLoss }))
    table.get.mockImplementation(async (key) => {
      if (key === 'block-2') throw dataLoss
      return rows.find((row) => row.id === key)
    })
    dexieMock.table.mockReturnValue(table)

    const result = await new DexieExporter('/export').exportAll()

    expect(JSON.parse(exportedText())).toEqual([{ id: 'block-1' }, { id: 'block-3' }])
    expect(result).toEqual({
      exportPath: '/export',
      recoveryReports: [
        {
          scope: 'records',
          table: 'message_blocks',
          skippedRecords: 1,
          samplePrimaryKeys: ['block-2']
        }
      ]
    })
    expect(loggerWarn).toHaveBeenCalledWith(
      'Recovering from irrecoverable IndexedDB read error',
      expect.objectContaining({
        errorMessage: 'Dexie read failed',
        errorName: 'Error',
        operation: 'bulkGet',
        scope: 'records',
        tableName: 'message_blocks',
        wrappedErrors: [
          expect.objectContaining({
            errorMessage: 'Data lost due to missing file. Affected record should be considered irrecoverable',
            errorName: 'NotReadableError'
          })
        ]
      })
    )
  })

  it('skips an irrecoverable fallback record that disappeared before get', async () => {
    const rows = [{ id: 'block-1' }, { id: 'block-2' }, { id: 'block-3' }]
    const table = createTableMock(rows)
    const dataLoss = new DOMException(
      'Data lost due to missing file. Affected record should be considered irrecoverable',
      'NotReadableError'
    )
    table.bulkGet.mockRejectedValueOnce(dataLoss)
    table.get.mockImplementation(async (key) => (key === 'block-2' ? undefined : rows.find((row) => row.id === key)))
    dexieMock.table.mockReturnValue(table)

    const result = await new DexieExporter('/export').exportAll()

    expect(JSON.parse(exportedText())).toEqual([{ id: 'block-1' }, { id: 'block-3' }])
    expect(result.recoveryReports).toEqual([
      {
        scope: 'records',
        table: 'message_blocks',
        skippedRecords: 1,
        samplePrimaryKeys: ['block-2']
      }
    ])
  })

  it('keeps non-matching fallback get errors fatal', async () => {
    const rows = [{ id: 'block-1' }, { id: 'block-2' }]
    const table = createTableMock(rows)
    table.bulkGet.mockRejectedValueOnce(
      new DOMException(
        'Data lost due to missing file. Affected record should be considered irrecoverable',
        'NotReadableError'
      )
    )
    table.get.mockImplementation(async (key) => {
      if (key === 'block-2') throw new Error('transient read failure')
      return rows.find((row) => row.id === key)
    })
    dexieMock.table.mockReturnValue(table)

    await expect(new DexieExporter('/export').exportAll()).rejects.toThrow(
      'Failed to export Dexie table "message_blocks" at primary key "block-2": transient read failure'
    )
  })

  it('exports an empty table when its primary keys cannot be read', async () => {
    const table = createTableMock([{ id: 'block-1' }])
    table.primaryKeys.mockRejectedValueOnce(
      new DOMException(
        'Data lost due to missing file. Affected record should be considered irrecoverable',
        'NotReadableError'
      )
    )
    dexieMock.table.mockReturnValue(table)

    const result = await new DexieExporter('/export').exportAll()

    expect(exportedText()).toBe('[]')
    expect(result).toEqual({
      exportPath: '/export',
      recoveryReports: [{ scope: 'table', table: 'message_blocks' }]
    })
  })

  it('overwrites earlier pages when primary-key enumeration fails mid-table', async () => {
    const rows = Array.from({ length: 105 }, (_, index) => ({ id: `block-${String(index).padStart(3, '0')}` }))
    const table = createTableMock(rows)
    table.primaryKeys
      .mockResolvedValueOnce(rows.slice(0, 100).map((row) => row.id))
      .mockRejectedValueOnce(
        new DOMException(
          'Data lost due to missing file. Affected record should be considered irrecoverable',
          'NotReadableError'
        )
      )
    dexieMock.table.mockReturnValue(table)

    const result = await new DexieExporter('/export').exportAll()

    expect(exportedText()).toBe('[]')
    expect(result.recoveryReports).toEqual([{ scope: 'table', table: 'message_blocks' }])
    expect(invoke.mock.calls).toContainEqual([
      MigrationIpcChannels.WriteExportFile,
      '/export',
      'message_blocks',
      '[]',
      'overwrite'
    ])
  })

  it('exports every supported table as empty when the database cannot be inspected', async () => {
    dexieMock.exists.mockRejectedValueOnce(
      new DOMException(
        'Data lost due to missing file. Affected record should be considered irrecoverable',
        'NotReadableError'
      )
    )

    const result = await new DexieExporter('/export').exportAll()

    const emptyTableWrites = invoke.mock.calls
      .filter(([channel]) => channel === MigrationIpcChannels.WriteExportFile)
      .map(([, exportPath, tableName, chunk, writeMode]) => ({ exportPath, tableName, chunk, writeMode }))
    expect(emptyTableWrites).toEqual(
      [
        'topics',
        'files',
        'knowledge_notes',
        'message_blocks',
        'settings',
        'translate_history',
        'quick_phrases',
        'translate_languages'
      ].map((tableName) => ({ exportPath: '/export', tableName, chunk: '[]', writeMode: 'overwrite' }))
    )
    expect(result).toEqual({
      exportPath: '/export',
      recoveryReports: [{ scope: 'database' }]
    })
  })

  it('finds irrecoverable data loss in either branch of a wrapped error', async () => {
    const dataLoss = new DOMException(
      'Data lost due to missing file. Affected record should be considered irrecoverable',
      'NotReadableError'
    )
    dexieMock.exists.mockRejectedValueOnce({
      cause: new Error('Unrelated wrapper cause'),
      inner: dataLoss,
      message: 'Dexie read failed'
    })

    const result = await new DexieExporter('/export').exportAll()

    expect(result.recoveryReports).toEqual([{ scope: 'database' }])
  })

  it('closes the failed database handle before recovering from an open error', async () => {
    dexieMock.open.mockRejectedValueOnce(
      new DOMException(
        'Data lost due to missing file. Affected record should be considered irrecoverable',
        'NotReadableError'
      )
    )

    const result = await new DexieExporter('/export').exportAll()

    expect(result.recoveryReports).toEqual([{ scope: 'database' }])
    expect(dexieMock.close).toHaveBeenCalledOnce()
  })

  it('closes the failed database handle and rejects a non-matching open error', async () => {
    dexieMock.open.mockRejectedValueOnce(new DOMException('Database is temporarily unavailable', 'NotReadableError'))

    await expect(new DexieExporter('/export').exportAll()).rejects.toThrow('Database is temporarily unavailable')

    expect(dexieMock.close).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('aggregates skipped records across pages and caps primary-key samples', async () => {
    const rows = Array.from({ length: 105 }, (_, index) => ({
      id: `block-${String(index).padStart(3, '0')}`,
      secret: `content-${index}`
    }))
    const badIds = new Set([...Array.from({ length: 11 }, (_, index) => rows[index].id), rows[101].id])
    const dataLoss = new DOMException(
      'Data lost due to missing file. Affected record should be considered irrecoverable',
      'NotReadableError'
    )
    const table = createTableMock(rows)
    table.bulkGet.mockImplementation(async (keys) => {
      if (keys.some((key) => badIds.has(key))) throw dataLoss
      return keys.map((key) => rows.find((row) => row.id === key))
    })
    table.get.mockImplementation(async (key) => {
      if (badIds.has(key)) throw dataLoss
      return rows.find((row) => row.id === key)
    })
    dexieMock.table.mockReturnValue(table)

    const result = await new DexieExporter('/export').exportAll()

    const exported = JSON.parse(exportedText()) as LegacyRecord[]
    expect(exported).toHaveLength(93)
    expect(exported.some((row) => badIds.has(row.id))).toBe(false)
    expect(result.recoveryReports).toEqual([
      {
        scope: 'records',
        table: 'message_blocks',
        skippedRecords: 12,
        samplePrimaryKeys: Array.from({ length: 10 }, (_, index) => `block-${String(index).padStart(3, '0')}`)
      }
    ])
    expect(JSON.stringify(result)).not.toContain('content-')
  })

  it('does not degrade for other IndexedDB read errors', async () => {
    dexieMock.exists.mockRejectedValueOnce(new DOMException('Failed to read large IndexedDB value', 'NotReadableError'))

    await expect(new DexieExporter('/export').exportAll()).rejects.toThrow('Failed to read large IndexedDB value')
    expect(invoke).not.toHaveBeenCalledWith(
      MigrationIpcChannels.WriteExportFile,
      expect.anything(),
      expect.anything(),
      '[]',
      'overwrite'
    )
  })

  it('fails when an empty-table recovery export cannot be written', async () => {
    const table = createTableMock([{ id: 'block-1' }])
    table.primaryKeys.mockRejectedValueOnce(
      new DOMException(
        'Data lost due to missing file. Affected record should be considered irrecoverable',
        'NotReadableError'
      )
    )
    dexieMock.table.mockReturnValue(table)
    invoke.mockImplementation((_channel, _exportPath, _tableName, chunk) =>
      chunk === '[]' ? Promise.reject(new Error('disk full')) : Promise.resolve(true)
    )

    await expect(new DexieExporter('/export').exportAll()).rejects.toThrow('disk full')
    expect(dexieMock.close).toHaveBeenCalledOnce()
  })
})
