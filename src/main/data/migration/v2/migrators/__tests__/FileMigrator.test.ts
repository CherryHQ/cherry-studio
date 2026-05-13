import fs from 'node:fs'

import type { FileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loggerWarnMock } = vi.hoisted(() => ({
  loggerWarnMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: loggerWarnMock,
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

vi.mock('node:fs', async () => {
  const { createNodeFsMock } = await import('@test-helpers/mocks/nodeFsMock')
  return createNodeFsMock()
})

import { FileMigrator } from '../FileMigrator'
import { getAllMigrators } from '../index'

// ─── Helpers ────────────────────────────────────────────────────────────────

const MOCK_USER_DATA = '/mock/userData'

function makeInternalRow(overrides: Partial<FileMetadata> = {}): FileMetadata {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'report',
    origin_name: 'report.pdf',
    path: `${MOCK_USER_DATA}/Data/Files/550e8400-e29b-41d4-a716-446655440000.pdf`,
    size: 1024,
    ext: '.pdf',
    type: 'document',
    created_at: '2024-01-01T00:00:00.000Z',
    count: 1,
    ...overrides
  }
}

function makeExternalRow(overrides: Partial<FileMetadata> = {}): FileMetadata {
  return {
    id: 'ext-file-v4-id-001',
    name: 'notes.txt',
    origin_name: 'notes.txt',
    path: '/Users/alice/Documents/notes.txt',
    size: 512,
    ext: '.txt',
    type: 'document',
    created_at: '2024-03-01T00:00:00.000Z',
    count: 1,
    ...overrides
  }
}

function createMockContext(rows: FileMetadata[], overrides: Record<string, unknown> = {}) {
  const insertValues = vi.fn().mockResolvedValue(undefined)
  const insertFn = vi.fn().mockReturnValue({ values: insertValues })

  const txFn = vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    await cb({ insert: insertFn })
  })

  const selectFn = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValue({ count: 0 }),
      where: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue([])
      })
    })
  })

  const reader = {
    readInBatches: vi.fn().mockImplementation(async (_size: number, cb: (rows: FileMetadata[]) => Promise<void>) => {
      await cb(rows)
    })
  }

  const ctx = {
    sources: {
      dexieExport: {
        tableExists: vi.fn().mockResolvedValue(rows.length > 0),
        createStreamReader: vi.fn().mockReturnValue(reader)
      }
    },
    db: {
      transaction: txFn,
      select: selectFn
    },
    sharedData: new Map<string, unknown>(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    paths: { userData: MOCK_USER_DATA },
    ...overrides
  }

  return { ctx, insertFn, insertValues, txFn, selectFn, reader }
}

// ─── Metadata ───────────────────────────────────────────────────────────────

describe('FileMigrator metadata', () => {
  it('has correct id, name, and order', () => {
    const m = new FileMigrator()
    expect(m.id).toBe('file')
    expect(m.name).toBe('Files')
    expect(m.order).toBe(2.7)
  })
})

// ─── Registration ───────────────────────────────────────────────────────────

describe('FileMigrator registration', () => {
  it('is registered at order 2.7 in getAllMigrators()', () => {
    const migrators = getAllMigrators()
    const fileMigrator = migrators.find((m) => m.id === 'file')
    expect(fileMigrator).toBeDefined()
    expect(fileMigrator?.order).toBe(2.7)
  })
})

// ─── ID translation + idRemap (Task 2.2) ────────────────────────────────────

describe('FileMigrator ID translation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('v7 ids are preserved as-is (identity)', async () => {
    const v7Id = '018f4e4a-7b3d-7b3d-8b3d-9b3d0b3d1b3d'
    const row = makeInternalRow({
      id: v7Id,
      path: `${MOCK_USER_DATA}/Data/Files/${v7Id}.pdf`
    })
    const { ctx } = createMockContext([row])
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const idRemap = ctx.sharedData.get('file.idRemap') as Map<string, string>
    expect(idRemap).toBeDefined()
    // v7 ids have version nibble = 7 at position 14
    expect(idRemap.get(v7Id)).toBe(v7Id)
  })

  it('v4 ids are deterministically translated to v7 via uuidv5', async () => {
    const v4Id = '550e8400-e29b-41d4-a716-446655440000'
    const row = makeInternalRow({ id: v4Id, path: `${MOCK_USER_DATA}/Data/Files/${v4Id}.pdf` })
    const { ctx } = createMockContext([row])
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const idRemap = ctx.sharedData.get('file.idRemap') as Map<string, string>
    expect(idRemap).toBeDefined()

    const newId = idRemap.get(v4Id)
    expect(newId).toBeDefined()
    // Must be different from original
    expect(newId).not.toBe(v4Id)
    // Must be a valid UUID format
    expect(newId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('same v4 id maps to same v7 id on repeated runs (deterministic)', async () => {
    const v4Id = '550e8400-e29b-41d4-a716-446655440000'
    const row = makeInternalRow({ id: v4Id, path: `${MOCK_USER_DATA}/Data/Files/${v4Id}.pdf` })

    const { ctx: ctx1 } = createMockContext([row])
    const m1 = new FileMigrator()
    await m1.prepare(ctx1 as never)
    await m1.execute(ctx1 as never)

    const { ctx: ctx2 } = createMockContext([row])
    const m2 = new FileMigrator()
    await m2.prepare(ctx2 as never)
    await m2.execute(ctx2 as never)

    const idRemap1 = ctx1.sharedData.get('file.idRemap') as Map<string, string>
    const idRemap2 = ctx2.sharedData.get('file.idRemap') as Map<string, string>
    expect(idRemap1.get(v4Id)).toBe(idRemap2.get(v4Id))
  })

  it('sharedData file.idRemap contains all migrated ids', async () => {
    const rows = [
      makeInternalRow({
        id: 'aaaabbbb-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        path: `${MOCK_USER_DATA}/Data/Files/aaaabbbb-aaaa-4aaa-aaaa-aaaaaaaaaaaa.pdf`
      }),
      makeInternalRow({
        id: 'bbbbcccc-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
        path: `${MOCK_USER_DATA}/Data/Files/bbbbcccc-bbbb-4bbb-bbbb-bbbbbbbbbbbb.txt`,
        name: 'notes',
        origin_name: 'notes.txt',
        ext: '.txt'
      })
    ]
    const { ctx } = createMockContext(rows)
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const idRemap = ctx.sharedData.get('file.idRemap') as Map<string, string>
    expect(idRemap.size).toBe(2)
    expect(idRemap.has('aaaabbbb-aaaa-4aaa-aaaa-aaaaaaaaaaaa')).toBe(true)
    expect(idRemap.has('bbbbcccc-bbbb-4bbb-bbbb-bbbbbbbbbbbb')).toBe(true)
  })
})

// ─── Origin discrimination (Task 2.3) ───────────────────────────────────────

describe('FileMigrator origin discrimination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('path under userData/Data/Files → origin=internal, no externalPath', async () => {
    const row = makeInternalRow()
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    expect(insertValues).toHaveBeenCalled()
    const inserted = insertValues.mock.calls[0][0]
    expect(Array.isArray(inserted) ? inserted[0].origin : inserted.origin).toBe('internal')
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    expect(firstRow.externalPath).toBeNull()
    expect(typeof firstRow.size).toBe('number')
  })

  it('absolute path outside userData → origin=external, externalPath = row.path', async () => {
    const row = makeExternalRow()
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    expect(insertValues).toHaveBeenCalled()
    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    expect(firstRow.origin).toBe('external')
    expect(firstRow.externalPath).toBe('/Users/alice/Documents/notes.txt')
    expect(firstRow.size).toBeNull()
  })
})

// ─── Ext normalization (Task 2.4) ────────────────────────────────────────────

describe('FileMigrator ext normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('leading dot is stripped from ext (.pdf → pdf)', async () => {
    const row = makeInternalRow({ ext: '.pdf' })
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    expect(firstRow.ext).toBe('pdf')
  })

  it('ext without leading dot is preserved as-is (txt → txt)', async () => {
    const row = makeInternalRow({ ext: 'txt' })
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    expect(firstRow.ext).toBe('txt')
  })

  it('empty ext → null', async () => {
    const row = makeInternalRow({ ext: '' })
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    expect(firstRow.ext).toBeNull()
  })
})

// ─── Dead fields dropped (Task 2.5) ──────────────────────────────────────────

describe('FileMigrator dead v1 fields are dropped', () => {
  it('v2 row shape does not include count, tokens, purpose, type', async () => {
    const row = makeInternalRow({ count: 99, tokens: 1234 })
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    expect(firstRow).not.toHaveProperty('count')
    expect(firstRow).not.toHaveProperty('tokens')
    expect(firstRow).not.toHaveProperty('purpose')
    expect(firstRow).not.toHaveProperty('type')
    // v1 name fields should not appear either
    expect(firstRow).not.toHaveProperty('origin_name')
    expect(firstRow).not.toHaveProperty('created_at')
  })
})

// ─── created_at ISO → epoch (Task 2.6) ───────────────────────────────────────

describe('FileMigrator created_at conversion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ISO 8601 string is converted to ms epoch integer', async () => {
    const row = makeInternalRow({ created_at: '2024-06-15T12:00:00.000Z' })
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    expect(firstRow.createdAt).toBe(new Date('2024-06-15T12:00:00.000Z').getTime())
  })

  it('invalid date string falls back to Date.now() (within 5 second window)', async () => {
    const before = Date.now()
    const row = makeInternalRow({ created_at: 'not-a-date' })
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const after = Date.now()
    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    expect(firstRow.createdAt).toBeGreaterThanOrEqual(before)
    expect(firstRow.createdAt).toBeLessThanOrEqual(after + 5000)
  })
})

// ─── Batched insert + rollback (Task 2.7) ────────────────────────────────────

describe('FileMigrator batched insert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses ctx.db.transaction for inserts', async () => {
    const row = makeInternalRow()
    const { ctx, txFn } = createMockContext([row])
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    expect(txFn).toHaveBeenCalledTimes(1)
  })

  it('returns error result when transaction throws', async () => {
    const row = makeInternalRow()
    const { ctx } = createMockContext([row])
    // Override transaction to throw
    ;(ctx.db as any).transaction = vi.fn().mockRejectedValue(new Error('insert failed'))
    // Override select so idempotency check finds nothing
    ;(ctx.db as any).select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue([])
        })
      })
    })

    const m = new FileMigrator()
    await m.prepare(ctx as never)
    const result = await m.execute(ctx as never)

    expect(result.success).toBe(false)
    expect(result.error).toContain('insert failed')
  })
})

// ─── Idempotency (Task 2.8) ──────────────────────────────────────────────────

describe('FileMigrator idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('second execute is a no-op when rows already exist', async () => {
    const row = makeInternalRow()
    const { ctx, txFn } = createMockContext([row])

    const m = new FileMigrator()
    await m.prepare(ctx as never)

    // First execute: row doesn't exist yet
    ;(ctx.db as any).select = vi.fn().mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue([])
        })
      })
    })
    await m.execute(ctx as never)

    // Capture the translated id from idRemap after first execute
    const idRemap = ctx.sharedData.get('file.idRemap') as Map<string, string>
    const translatedId = idRemap.get(row.id)!

    // Reset transaction tracking
    txFn.mockClear()

    // Second execute: row already exists (idempotent) — return the actual translated id
    ;(ctx.db as any).select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue([{ id: translatedId }])
        })
      })
    })

    m.reset()
    await m.prepare(ctx as never)
    const result = await m.execute(ctx as never)

    expect(result.success).toBe(true)
    // No new transactions needed — rows already in DB
    expect(txFn).not.toHaveBeenCalled()
  })
})

// ─── Physical file sampling in validate (Task 2.9) ──────────────────────────

describe('FileMigrator validate physical file sampling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const existsSyncMock = fs.existsSync as unknown as {
      mockReset?: () => void
      mockReturnValue?: (v: boolean) => void
    }
    existsSyncMock.mockReset?.()
  })

  it('validate reports missing physical files', async () => {
    const row = makeInternalRow()
    const { ctx } = createMockContext([row])
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    // DB says 1 entry
    ;(ctx.db as any).select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ count: 1 })
      })
    })

    // File does not exist on disk
    const existsSyncMock = fs.existsSync as unknown as { mockReturnValue: (v: boolean) => void }
    existsSyncMock.mockReturnValue(false)

    const result = await m.validate(ctx as never)

    expect(result.success).toBe(false)
    expect(result.errors.some((e) => e.key === 'file_entry_missing_physical_file')).toBe(true)
  })

  it('validate succeeds when all sampled physical files exist', async () => {
    const row = makeInternalRow()
    const { ctx } = createMockContext([row])
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    // DB says 1 entry
    ;(ctx.db as any).select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ count: 1 })
      })
    })

    // File exists on disk
    const existsSyncMock = fs.existsSync as unknown as { mockReturnValue: (v: boolean) => void }
    existsSyncMock.mockReturnValue(true)

    const result = await m.validate(ctx as never)

    expect(result.success).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
})

// ─── Malformed rows (Task 2.10) ──────────────────────────────────────────────

describe('FileMigrator malformed row handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rows missing id are skipped with a warning', async () => {
    const badRow = { ...makeInternalRow(), id: '' } as any
    const goodRow = makeInternalRow({ id: 'aaaabbbb-aaaa-4aaa-aaaa-aaaaaaaaaaaa' })
    const { ctx } = createMockContext([badRow, goodRow])

    const m = new FileMigrator()
    const result = await m.prepare(ctx as never)

    expect(result.success).toBe(true)
    expect(result.itemCount).toBe(2)
    // One row skipped
    const state = m as any
    expect(state.skippedCount).toBe(1)
    expect(state.preparedEntries).toHaveLength(1)
    // Warning logged via module-level logger
    expect(loggerWarnMock).toHaveBeenCalled()
  })

  it('rows missing path are skipped', async () => {
    const badRow = { ...makeInternalRow(), path: '' } as any
    const { ctx } = createMockContext([badRow])

    const m = new FileMigrator()
    await m.prepare(ctx as never)

    const state = m as any
    expect(state.skippedCount).toBe(1)
    expect(state.preparedEntries).toHaveLength(0)
  })

  it('rows missing name are skipped', async () => {
    const badRow = { ...makeInternalRow(), name: '' } as any
    const { ctx } = createMockContext([badRow])

    const m = new FileMigrator()
    await m.prepare(ctx as never)

    const state = m as any
    expect(state.skippedCount).toBe(1)
    expect(state.preparedEntries).toHaveLength(0)
  })

  it('execute still succeeds after skipping malformed rows', async () => {
    const badRow = { ...makeInternalRow(), id: '' } as any
    const goodRow = makeInternalRow({ id: 'ccccdddd-cccc-4ccc-cccc-cccccccccccc' })
    const { ctx } = createMockContext([badRow, goodRow])

    const m = new FileMigrator()
    await m.prepare(ctx as never)
    const result = await m.execute(ctx as never)

    expect(result.success).toBe(true)
    expect(result.processedCount).toBe(1)
  })
})
