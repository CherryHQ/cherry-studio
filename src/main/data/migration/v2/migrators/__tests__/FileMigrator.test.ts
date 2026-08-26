import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { FileEntrySchema } from '@shared/data/types/file'
import type { FileMetadata } from '@shared/data/types/legacyFile'
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

import { application } from '@application'
import { resolvePhysicalPath } from '@main/services/file/utils/pathResolver'

import { FileMigrator } from '../FileMigrator'
import { getAllMigrators } from '../migratorRegistry'

// ─── Helpers ────────────────────────────────────────────────────────────────

const MOCK_USER_DATA = '/mock/userData'

/**
 * The path the migrator will actually probe for a given storage name. Built with `path.join`
 * exactly as the production code does, so an `fs.existsSync` mock keyed on it matches on win32
 * too — a hand-written `/`-joined string silently never matches there, which would leave the
 * cross-platform cases below asserting nothing on the one platform they exist for.
 */
const storagePath = (storageName: string) => path.join(MOCK_USER_DATA, 'Data', 'Files', storageName)

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

/**
 * Seed a real temp `{userData}/Data/Files` holding one raw-named v1 blob, and point the mocked
 * fs surface the copy path uses at it. Real fs because materializing `{id}.{ext}` — copy, fsync,
 * rename, cleanup — is the thing under test; a mocked `renameSync` would assert nothing.
 */
function useRealFilesDir(realFs: typeof fs, ext: string) {
  const userData = realFs.mkdtempSync(path.join(os.tmpdir(), 'file-migrator-'))
  const filesDir = path.join(userData, 'Data', 'Files')
  realFs.mkdirSync(filesDir, { recursive: true })

  const row = makeInternalRow({ id: '33333333-3333-4333-8333-333333333333', ext, path: 'D:\\legacy\\x.exe' })
  realFs.writeFileSync(path.join(filesDir, `${row.id}${ext}`), 'payload')

  vi.mocked(fs.existsSync).mockImplementation(realFs.existsSync)
  vi.mocked(fs.renameSync).mockImplementation(realFs.renameSync)
  vi.mocked(fs.unlinkSync).mockImplementation(realFs.unlinkSync)
  vi.mocked(application.getPath).mockImplementation(((_key: string, filename?: string) =>
    path.join(filesDir, filename ?? '')) as never)

  return { userData, filesDir, row }
}

// Desensitized from the reporter's actual DB row in #15733: an internal file
// created on Windows whose data was then synced to a POSIX machine before
// migrating. The prefix check is guaranteed to miss (different separators),
// so physical presence in the local Files dir is the only reliable signal.
const FIXTURE_WINDOWS_ROW: FileMetadata = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '11111111-1111-4111-8111-111111111111.png',
  origin_name: 'Screenshot_2025-03-13_21-25-45.png',
  path: 'C:\\Users\\testuser\\AppData\\Roaming\\CherryStudio\\Data\\Files\\11111111-1111-4111-8111-111111111111.png',
  size: 442074,
  ext: '.png',
  type: 'image',
  created_at: '2025-03-13T13:34:04.480Z',
  count: 1
}

// Same cross-platform restore, but the row was written by v1's duplicate-upload path
// (FileStorage.findDuplicateFile): `name` gained a second extension and `origin_name` was
// overwritten with the storage name. `{id}.png.png` does not exist on disk, so trusting `name`
// makes both internal checks fail and strands the physical file for the FS orphan sweep.
const FIXTURE_DEDUP_WINDOWS_ROW: FileMetadata = {
  id: '22222222-2222-4222-8222-222222222222',
  name: '22222222-2222-4222-8222-222222222222.png.png',
  origin_name: '22222222-2222-4222-8222-222222222222.png',
  path: 'C:\\Users\\testuser\\AppData\\Roaming\\CherryStudio\\Data\\Files\\22222222-2222-4222-8222-222222222222.png',
  size: 442074,
  ext: '.png',
  type: 'image',
  created_at: '2025-03-13T13:34:04.480Z',
  count: 2
}

function createMockContext(rows: FileMetadata[], overrides: Record<string, unknown> = {}) {
  const insertValues = vi.fn().mockReturnValue({ run: vi.fn() })
  const insertFn = vi.fn().mockReturnValue({ values: insertValues })

  const txFn = vi.fn().mockImplementation((cb: (tx: unknown) => void) => {
    cb({ insert: insertFn })
  })

  const selectFn = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({ count: 0 }),
      where: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(null),
        all: vi.fn().mockReturnValue([])
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

// ─── ID preservation (per migration-plan §2.9) ──────────────────────────────

describe('FileMigrator id preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves v7 ids verbatim into file_entry', async () => {
    const v7Id = '018f4e4a-7b3d-7b3d-8b3d-9b3d0b3d1b3d'
    const row = makeInternalRow({
      id: v7Id,
      path: `${MOCK_USER_DATA}/Data/Files/${v7Id}.pdf`
    })
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    expect(firstRow.id).toBe(v7Id)
  })

  it('preserves v4 ids verbatim (no translation, no idRemap)', async () => {
    const v4Id = '550e8400-e29b-41d4-a716-446655440000'
    const row = makeInternalRow({ id: v4Id, path: `${MOCK_USER_DATA}/Data/Files/${v4Id}.pdf` })
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    expect(firstRow.id).toBe(v4Id)
    expect(ctx.sharedData.has('file.idRemap')).toBe(false)
  })

  it('repeated execute on the same fixture produces identical file_entry rows', async () => {
    const v4Id = '550e8400-e29b-41d4-a716-446655440000'
    const row = makeInternalRow({ id: v4Id, path: `${MOCK_USER_DATA}/Data/Files/${v4Id}.pdf` })

    const { ctx: ctx1, insertValues: insert1 } = createMockContext([row])
    const m1 = new FileMigrator()
    await m1.prepare(ctx1 as never)
    await m1.execute(ctx1 as never)

    const { ctx: ctx2, insertValues: insert2 } = createMockContext([row])
    const m2 = new FileMigrator()
    await m2.prepare(ctx2 as never)
    await m2.execute(ctx2 as never)

    const firstId1 = (Array.isArray(insert1.mock.calls[0][0]) ? insert1.mock.calls[0][0][0] : insert1.mock.calls[0][0])
      .id
    const firstId2 = (Array.isArray(insert2.mock.calls[0][0]) ? insert2.mock.calls[0][0][0] : insert2.mock.calls[0][0])
      .id
    expect(firstId1).toBe(firstId2)
    expect(firstId1).toBe(v4Id)
  })

  it('inserts every prepared row exactly once', async () => {
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
    const { ctx, insertValues } = createMockContext(rows)
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const inserted = insertValues.mock.calls[0][0]
    const ids = (Array.isArray(inserted) ? inserted : [inserted]).map((r: { id: string }) => r.id)
    expect(ids).toEqual(['aaaabbbb-aaaa-4aaa-aaaa-aaaaaaaaaaaa', 'bbbbcccc-bbbb-4bbb-bbbb-bbbbbbbbbbbb'])
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

  it.each([
    ['trailing space', '.exe '],
    ['trailing dot', '.exe.']
  ])('normalizes OS-ignored %s in ext to the effective extension', async (_label, ext) => {
    const row = makeInternalRow({ ext })
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    expect(firstRow.ext).toBe('exe')
  })

  it('ext containing path separator is rejected as malformed', async () => {
    const row = makeInternalRow({ id: '550e8400-e29b-41d4-a716-446655440099', ext: 'pdf/exe' })
    const { ctx } = createMockContext([row])
    const m = new FileMigrator()
    const result = await m.prepare(ctx as never)

    expect(result.success).toBe(true)
    const joined = (result.warnings ?? []).join('\n')
    expect(joined).toContain('Invalid ext')
    expect(joined).toContain(row.id)
  })

  it('ext containing null byte is rejected as malformed', async () => {
    const row = makeInternalRow({ id: '550e8400-e29b-41d4-a716-44665544009a', ext: 'a\0b' })
    const { ctx } = createMockContext([row])
    const m = new FileMigrator()
    const result = await m.prepare(ctx as never)

    expect(result.success).toBe(true)
    const joined = (result.warnings ?? []).join('\n')
    expect(joined).toContain('Invalid ext')
  })
})

// ─── Size handling ───────────────────────────────────────────────────────────

describe('FileMigrator size handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.existsSync).mockReset()
    vi.mocked(fs.statSync).mockReset()
  })

  it('invalid size with a present physical file: size recovered from disk instead of skipping', async () => {
    const row = makeInternalRow({
      id: '550e8400-e29b-41d4-a716-446655440012',
      size: 'big' as unknown as number
    })
    vi.mocked(fs.statSync).mockReturnValue({ size: 2048 } as fs.Stats)
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    const result = await m.prepare(ctx as never)
    await m.execute(ctx as never)

    expect(insertValues).toHaveBeenCalled()
    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    expect(firstRow.size).toBe(2048)
    const joined = (result.warnings ?? []).join('\n')
    expect(joined).toContain('Invalid size')
    expect(joined).toContain('recovered size=2048')
  })

  it('non-numeric size with no recoverable physical file: row skipped, warning carries row id and raw value', async () => {
    const row = makeInternalRow({
      id: '550e8400-e29b-41d4-a716-446655440010',
      size: 'big' as unknown as number
    })
    vi.mocked(fs.statSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    const result = await m.prepare(ctx as never)
    await m.execute(ctx as never)

    expect(result.success).toBe(true)
    const joined = (result.warnings ?? []).join('\n')
    expect(joined).toContain('Invalid size')
    expect(joined).toContain(row.id)
    expect(joined).toContain('"big"')
    expect(joined).toContain('skipping row')

    // Row was skipped — no insert happened (single-row fixture).
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('negative size with no recoverable physical file: row skipped, warning carries raw value', async () => {
    const row = makeInternalRow({ id: '550e8400-e29b-41d4-a716-446655440011', size: -1 })
    vi.mocked(fs.statSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    const result = await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const joined = (result.warnings ?? []).join('\n')
    expect(joined).toContain('Invalid size')
    expect(joined).toContain('-1')
    expect(joined).toContain('skipping row')

    expect(insertValues).not.toHaveBeenCalled()
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

  it('invalid date string records a warning carrying the row id and raw value', async () => {
    const row = makeInternalRow({
      id: '550e8400-e29b-41d4-a716-446655440000',
      created_at: 'not-a-date'
    })
    const { ctx } = createMockContext([row])
    const m = new FileMigrator()
    const result = await m.prepare(ctx as never)

    expect(result.success).toBe(true)
    expect(result.warnings).toBeDefined()
    const joined = (result.warnings ?? []).join('\n')
    expect(joined).toContain('Invalid created_at')
    expect(joined).toContain(row.id)
    expect(joined).toContain('not-a-date')
  })

  it('missing created_at is silent (no warning, falls back to Date.now())', async () => {
    const row = makeInternalRow({ created_at: undefined as unknown as string })
    const { ctx } = createMockContext([row])
    const m = new FileMigrator()
    const result = await m.prepare(ctx as never)

    expect(result.success).toBe(true)
    const invalidWarnings = (result.warnings ?? []).filter((w) => w.includes('Invalid created_at'))
    expect(invalidWarnings).toHaveLength(0)
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
    ;(ctx.db as any).transaction = vi.fn().mockImplementation(() => {
      throw new Error('insert failed')
    })

    const m = new FileMigrator()
    await m.prepare(ctx as never)
    const result = await m.execute(ctx as never)

    expect(result.success).toBe(false)
    expect(result.error).toContain('insert failed')
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

  it('validate logs warnings for missing physical files instead of failing', async () => {
    const row = makeInternalRow()
    const { ctx } = createMockContext([row])
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    // DB says 1 entry
    ;(ctx.db as any).select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ count: 1 })
      })
    })

    // File does not exist on disk
    const existsSyncMock = fs.existsSync as unknown as { mockReturnValue: (v: boolean) => void }
    existsSyncMock.mockReturnValue(false)

    loggerWarnMock.mockClear()
    const result = await m.validate(ctx as never)

    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    expect(loggerWarnMock).toHaveBeenCalledWith(expect.stringContaining(`Physical file missing for entry id=${row.id}`))
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
        get: vi.fn().mockReturnValue({ count: 1 })
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
    // Note the RFC 4122 variant nibble must be [89ab] — the write-side
    // read-schema probe rejects ids the runtime FileEntryIdSchema would
    // reject anyway.
    const goodRow = makeInternalRow({ id: 'ccccdddd-cccc-4ccc-8ccc-cccccccccccc' })
    const { ctx } = createMockContext([badRow, goodRow])

    const m = new FileMigrator()
    await m.prepare(ctx as never)
    const result = await m.execute(ctx as never)

    expect(result.success).toBe(true)
    expect(result.processedCount).toBe(1)
  })
})

// ─── Cross-platform recovery (#15733) ────────────────────────────────────────

describe('FileMigrator cross-platform recovery (#15733)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('recovers a Windows-origin internal row on POSIX when the physical file is present', async () => {
    // Probe the storage name rebuilt from id+ext, not `row.name`: the migrator no longer reads
    // `name`, and asserting against it would leave this regression test blind to the deduped-row
    // case below (where the two differ).
    vi.mocked(fs.existsSync).mockImplementation((p) => p === storagePath(`${FIXTURE_WINDOWS_ROW.id}.png`))
    const { ctx, insertValues } = createMockContext([FIXTURE_WINDOWS_ROW])
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    expect(firstRow.origin).toBe('internal')
    expect(firstRow.name).toBe('Screenshot_2025-03-13_21-25-45')
    expect(firstRow.ext).toBe('png')
    expect(firstRow.size).toBe(442074)
    expect(firstRow.externalPath).toBeNull()
  })

  it('skips the same row as orphan when the physical file is absent', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const { ctx, insertValues } = createMockContext([FIXTURE_WINDOWS_ROW])
    const m = new FileMigrator()
    const result = await m.prepare(ctx as never)
    await m.execute(ctx as never)

    expect(insertValues).not.toHaveBeenCalled()
    const joined = (result.warnings ?? []).join('\n')
    expect(joined).toContain('Orphan file row')
    expect(joined).toContain(FIXTURE_WINDOWS_ROW.id)
  })

  it('recovers a deduped row whose double-extension name points at nothing', async () => {
    // Core regression: before rebuilding the storage name from id+ext, both internal checks
    // failed here (foreign-separator path, non-existent `{id}.png.png`) and the row was dropped.
    vi.mocked(fs.existsSync).mockImplementation((p) => p === storagePath(`${FIXTURE_DEDUP_WINDOWS_ROW.id}.png`))
    const { ctx, insertValues } = createMockContext([FIXTURE_DEDUP_WINDOWS_ROW])
    const m = new FileMigrator()
    const result = await m.prepare(ctx as never)
    await m.execute(ctx as never)

    expect(insertValues).toHaveBeenCalled()
    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    expect(firstRow.origin).toBe('internal')
    expect(firstRow.size).toBe(442074)
    expect((result.warnings ?? []).join('\n')).not.toContain('Orphan file row')
  })

  it('still skips the deduped row as orphan when no candidate exists on disk', async () => {
    // The fix must not turn every row internal — absence still means orphan.
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const { ctx, insertValues } = createMockContext([FIXTURE_DEDUP_WINDOWS_ROW])
    const m = new FileMigrator()
    const result = await m.prepare(ctx as never)
    await m.execute(ctx as never)

    expect(insertValues).not.toHaveBeenCalled()
    expect((result.warnings ?? []).join('\n')).toContain('Orphan file row')
  })

  it.each([
    ['trailing space', '.exe '],
    ['trailing dot', '.exe.']
  ])('makes an upload whose ext carries a %s readable at its v2 path (#18187)', async (_label, ext) => {
    // On POSIX the on-disk name really does keep the trailing character, but `ext` migrates
    // normalized and `resolvePhysicalPath` only ever composes `{id}.exe` — so asserting the
    // migrator found the file proves nothing; the bytes have to be readable through the resolver.
    const realFs = await vi.importActual<typeof fs>('node:fs')
    const { userData, filesDir, row } = useRealFilesDir(realFs, ext)

    const { ctx, insertValues } = createMockContext([row], { paths: { userData } })
    const m = new FileMigrator()
    const result = await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    const resolved = resolvePhysicalPath({ id: firstRow.id, origin: 'internal', ext: firstRow.ext })
    expect(realFs.readFileSync(resolved, 'utf8')).toBe('payload')
    // The raw blob stays put, so a migration that aborts leaves v1's own lookup intact.
    expect(realFs.existsSync(path.join(filesDir, `${row.id}${ext}`))).toBe(true)
    expect((result.warnings ?? []).join('\n')).not.toContain('Orphan file row')

    realFs.rmSync(userData, { recursive: true, force: true })
  })

  it('an interrupted copy publishes nothing, so the retry still repairs from the raw blob (#18187)', async () => {
    // A partial copy must never reach `{id}.exe`: the next run's candidate walk prefers whatever
    // sits there over the intact raw blob, so a truncated file would migrate as valid content
    // under the v1 `size`. Simulates the crash by failing after the tmp file is partly written.
    const realFs = await vi.importActual<typeof fs>('node:fs')
    const { userData, filesDir, row } = useRealFilesDir(realFs, '.exe ')
    const copySpy = vi.spyOn(fs, 'copyFileSync').mockImplementationOnce((_src, tmp) => {
      realFs.writeFileSync(tmp as string, 'pay')
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
    })

    const interrupted = await new FileMigrator().prepare(createMockContext([row], { paths: { userData } }).ctx as never)

    expect((interrupted.warnings ?? []).join('\n')).toContain('Failed to copy file')
    // Only the raw blob survives — no truncated canonical, no stranded `.tmp-{uuid}`.
    expect(realFs.readdirSync(filesDir)).toEqual([`${row.id}.exe `])

    copySpy.mockRestore()
    const { ctx, insertValues } = createMockContext([row], { paths: { userData } })
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    const resolved = resolvePhysicalPath({ id: firstRow.id, origin: 'internal', ext: firstRow.ext })
    expect(realFs.readFileSync(resolved, 'utf8')).toBe('payload')

    realFs.rmSync(userData, { recursive: true, force: true })
  })

  it('recovers a bad size from the rebuilt storage path', async () => {
    const row = { ...FIXTURE_DEDUP_WINDOWS_ROW, size: 'big' } as unknown as FileMetadata
    const physicalPath = storagePath(`${FIXTURE_DEDUP_WINDOWS_ROW.id}.png`)
    vi.mocked(fs.existsSync).mockImplementation((p) => p === physicalPath)
    vi.mocked(fs.statSync).mockReturnValue({ size: 2048 } as never)
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    expect(firstRow.size).toBe(2048)
    expect(vi.mocked(fs.statSync).mock.calls[0][0]).toBe(physicalPath)
  })
})

// ─── Lost original filename (v1 duplicate-upload bug) ────────────────────────

describe('FileMigrator lost original filename', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.existsSync).mockReset()
  })

  it('warns that a deduped row lost its user-facing name and keeps the storage name', async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => p === storagePath(`${FIXTURE_DEDUP_WINDOWS_ROW.id}.png`))
    const { ctx, insertValues } = createMockContext([FIXTURE_DEDUP_WINDOWS_ROW])
    const m = new FileMigrator()
    const result = await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const warnings = result.warnings ?? []
    const joined = warnings.join('\n')
    expect(joined).toContain('Original filename lost')
    expect(joined).toContain(FIXTURE_DEDUP_WINDOWS_ROW.id)
    // Exactly once. This migrator owns the global `files` row and is the sole producer of the
    // diagnostic — `KnowledgeMappings` and `ChatMappings` stay quiet so the user does not get one
    // notice per reference in the engine's concatenated, un-deduped warning list.
    expect(warnings.filter((warning) => warning.includes('Original filename lost'))).toHaveLength(1)
    // No better name exists — the id is what the file is now, and it matches its file on disk.
    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    expect(firstRow.name).toBe(FIXTURE_DEDUP_WINDOWS_ROW.id)
  })

  it('stays quiet for a normal upload', async () => {
    const { ctx } = createMockContext([makeInternalRow()])
    const m = new FileMigrator()
    const result = await m.prepare(ctx as never)

    expect((result.warnings ?? []).join('\n')).not.toContain('Original filename lost')
  })

  it('stays quiet for a base64 image, whose origin_name is the storage name by design', async () => {
    // saveBase64Image writes origin_name === name === `{uuid}.png` with a dotless `ext`. Nothing
    // was lost: a generated image never had a user filename. The predicate's number-one landmine.
    const id = '44444444-4444-4444-8444-444444444444'
    const row = makeInternalRow({
      id,
      name: `${id}.png`,
      origin_name: `${id}.png`,
      ext: 'png',
      path: `C:\\Users\\testuser\\AppData\\Roaming\\CherryStudio\\Data\\Files\\${id}.png`
    })
    vi.mocked(fs.existsSync).mockImplementation((p) => p === storagePath(`${id}.png`))
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    const result = await m.prepare(ctx as never)
    await m.execute(ctx as never)

    expect(insertValues).toHaveBeenCalled()
    expect((result.warnings ?? []).join('\n')).not.toContain('Original filename lost')
  })

  it('stays quiet for a normal upload referenced twice', async () => {
    // v1 `count` is a reference count (two messages attaching one file), not an upload counter.
    const { ctx } = createMockContext([makeInternalRow({ count: 2 })])
    const m = new FileMigrator()
    const result = await m.prepare(ctx as never)

    expect((result.warnings ?? []).join('\n')).not.toContain('Original filename lost')
  })

  it('warns for a deduped extensionless row', async () => {
    const id = '55555555-5555-4555-8555-555555555555'
    const row = makeInternalRow({ id, name: id, origin_name: id, ext: '', path: 'D:\\legacy\\README' })
    vi.mocked(fs.existsSync).mockImplementation((p) => p === storagePath(id))
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    const result = await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    expect(firstRow.ext).toBeNull()
    expect((result.warnings ?? []).join('\n')).toContain('Original filename lost')
  })
})

// ─── Name degradation chain ──────────────────────────────────────────────

describe('FileMigrator name degradation chain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('derives name from origin_name with extension stripped (normal path, no warning)', async () => {
    const row = makeInternalRow({ origin_name: 'My Report.v2.pdf' })
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    const result = await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    expect(firstRow.name).toBe('My Report.v2')
    const joined = (result.warnings ?? []).join('\n')
    expect(joined).not.toContain('Sanitized name')
  })

  it('sanitizes an origin_name containing separators instead of skipping the row', async () => {
    const row = makeInternalRow({ origin_name: 'evil\\dir/report.pdf' })
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    const result = await m.prepare(ctx as never)
    await m.execute(ctx as never)

    expect(insertValues).toHaveBeenCalled()
    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    expect(firstRow.name).toBe('report')
    const joined = (result.warnings ?? []).join('\n')
    expect(joined).toContain('Sanitized name')
    expect(joined).toContain(row.id)
  })

  it('falls back to the row id when the name exceeds the 255-char SafeNameSchema limit', async () => {
    // Sanitization (last segment + trim) cannot shorten a separator-free
    // over-long name, so the chain must terminate at the row id.
    const row = makeInternalRow({ origin_name: `${'x'.repeat(300)}.pdf` })
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    const result = await m.prepare(ctx as never)
    await m.execute(ctx as never)

    expect(insertValues).toHaveBeenCalled()
    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    expect(firstRow.name).toBe(row.id)
    const joined = (result.warnings ?? []).join('\n')
    expect(joined).toContain('falling back to row id')
  })

  it('falls back to the row id when sanitization cannot produce a safe name', async () => {
    const row = makeInternalRow({ origin_name: '..' })
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    const result = await m.prepare(ctx as never)
    await m.execute(ctx as never)

    expect(insertValues).toHaveBeenCalled()
    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    expect(firstRow.name).toBe(row.id)
    const joined = (result.warnings ?? []).join('\n')
    expect(joined).toContain('falling back to row id')
  })

  it('falls back to v1 storage name when origin_name is empty', async () => {
    const row = makeInternalRow({ origin_name: '' })
    const { ctx, insertValues } = createMockContext([row])
    const m = new FileMigrator()
    await m.prepare(ctx as never)
    await m.execute(ctx as never)

    const inserted = insertValues.mock.calls[0][0]
    const firstRow = Array.isArray(inserted) ? inserted[0] : inserted
    // makeInternalRow: name='report' (no dot) → stays as-is
    expect(firstRow.name).toBe('report')
  })
})

// ─── Write-side ≥ read-side validation invariant ────────────────────────────

describe('FileMigrator write/read validation invariant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('every prepared entry passes the runtime read schema', async () => {
    const rows = [
      makeInternalRow(),
      makeInternalRow({
        id: 'aaaabbbb-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        path: `${MOCK_USER_DATA}/Data/Files/aaaabbbb-aaaa-4aaa-aaaa-aaaaaaaaaaaa.pdf`,
        origin_name: 'evil\\dir/report.pdf'
      }),
      makeInternalRow({
        id: 'bbbbcccc-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
        path: `${MOCK_USER_DATA}/Data/Files/bbbbcccc-bbbb-4bbb-bbbb-bbbbbbbbbbbb.txt`,
        origin_name: '..',
        ext: '.txt'
      })
    ]
    const { ctx } = createMockContext(rows)
    const m = new FileMigrator()
    await m.prepare(ctx as never)

    const prepared = (m as any).preparedEntries as Array<Record<string, unknown>>
    expect(prepared).toHaveLength(3)
    for (const e of prepared) {
      expect(e.contentHash).toBeNull()
      const probe = FileEntrySchema.safeParse({
        id: e.id,
        origin: 'internal',
        name: e.name,
        ext: e.ext,
        cleanupPolicy: e.cleanupPolicy,
        size: e.size,
        contentHash: e.contentHash,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt
      })
      expect(probe.success).toBe(true)
    }
  })
})
