// Integration tests for `KnowledgeMigrator`'s legacy-file copy step.
//
// Runs KnowledgeMigrator against a real SQLite DB and a real temp filesystem so
// the copy from `<filesDataDir>/<storageName>` into
// `<knowledgeBaseDir>/<baseId>/<relativePath>` is exercised end to end:
//   - the upload is copied and the row's relativePath matches the file on disk,
//   - same-name uploads in one base get deduped relativePaths (no collision),
//   - a missing source degrades to a warning while keeping the item.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { knowledgeItemTable } from '@data/db/schemas/knowledge'
import type { FileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import { FileItemDataSchema } from '@shared/data/types/knowledge'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeMigrator } from '../KnowledgeMigrator'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

function dexieFileRow(
  overrides: Partial<FileMetadata> & Pick<FileMetadata, 'id' | 'name' | 'origin_name'>
): FileMetadata {
  return {
    id: overrides.id,
    name: overrides.name,
    origin_name: overrides.origin_name,
    path: overrides.path ?? `/legacy/${overrides.origin_name}`,
    size: overrides.size ?? 16,
    ext: overrides.ext ?? '.pdf',
    type: overrides.type ?? 'document',
    created_at: overrides.created_at ?? '2025-01-01T00:00:00.000Z',
    count: overrides.count ?? 1
  }
}

function makeCtx(
  dbh: ReturnType<typeof setupTestDatabase>,
  dexieFiles: FileMetadata[],
  reduxKnowledge: unknown,
  paths: { knowledgeBaseDir: string; filesDataDir: string }
) {
  return {
    sources: {
      dexieExport: {
        tableExists: vi.fn(async (name: string) => name === 'files' && dexieFiles.length > 0),
        createStreamReader: vi.fn((name: string) => ({
          readInBatches: vi.fn(async (_size: number, cb: (rows: FileMetadata[]) => Promise<void>) => {
            if (name === 'files') await cb(dexieFiles)
          })
        }))
      },
      reduxState: {
        getCategory: vi.fn(() => reduxKnowledge)
      }
    },
    db: dbh.db,
    sharedData: new Map<string, unknown>(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    paths: {
      userData: path.dirname(paths.filesDataDir),
      knowledgeBaseDir: paths.knowledgeBaseDir,
      filesDataDir: paths.filesDataDir
    }
  } as never
}

describe('KnowledgeMigrator legacy file copy (integration)', () => {
  const dbh = setupTestDatabase()
  let tempRoot: string | undefined

  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true })
      tempRoot = undefined
    }
  })

  it('copies uploads into the KB dir, dedupes same-name files, and degrades when a source is missing', async () => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'knowledge-file-copy-'))
    const filesDataDir = path.join(tempRoot, 'Files')
    const knowledgeBaseDir = path.join(tempRoot, 'KnowledgeBase')
    mkdirSync(filesDataDir, { recursive: true })
    writeFileSync(path.join(filesDataDir, 'a.bin'), 'A')
    writeFileSync(path.join(filesDataDir, 'b.bin'), 'B')
    // 'c.bin' intentionally not written — its source is missing.

    const dexieFiles: FileMetadata[] = [
      dexieFileRow({ id: 'fileA', name: 'a.bin', origin_name: 'report.pdf' }),
      dexieFileRow({ id: 'fileB', name: 'b.bin', origin_name: 'report.pdf' }),
      dexieFileRow({ id: 'fileC', name: 'c.bin', origin_name: 'missing.pdf' })
    ]
    const reduxKnowledge = {
      bases: [
        {
          id: 'kb-1',
          name: 'KB One',
          dimensions: 1024,
          model: { id: 'emb', name: 'emb', provider: 'openai' },
          items: [
            { id: 'item-a', type: 'file', content: 'fileA' },
            { id: 'item-b', type: 'file', content: 'fileB' },
            { id: 'item-c', type: 'file', content: 'fileC' }
          ]
        }
      ]
    }

    const ctx = makeCtx(dbh, dexieFiles, reduxKnowledge, { knowledgeBaseDir, filesDataDir })

    const migrator = new KnowledgeMigrator()
    const prepare = await migrator.prepare(ctx)
    expect(prepare.success).toBe(true)
    const baseId = (migrator as unknown as { preparedBases: { id: string }[] }).preparedBases[0].id

    const execute = await migrator.execute(ctx)
    expect(execute.success).toBe(true)
    // Execute-phase warnings are returned on the result (not just logged), so the engine
    // can surface "kept but not reindexable" diagnostics in the migration report.
    expect(execute.warnings?.some((w) => w.includes('source missing') && w.includes('c.bin'))).toBe(true)

    const rows = await dbh.db.select({ data: knowledgeItemTable.data }).from(knowledgeItemTable)
    const relativePaths = rows.map((row) => (row.data as { relativePath: string }).relativePath).sort()
    // report.pdf appears twice in the same base → deduped; the missing one keeps its name.
    expect(relativePaths).toEqual(['missing.pdf', 'report.pdf', 'report_1.pdf'])

    // Present sources are copied into the KB dir's `raw/` material root with their finalized relativePath.
    const copiedNames = ['report.pdf', 'report_1.pdf']
    const copiedContents = copiedNames
      .map((name) => readFileSync(path.join(knowledgeBaseDir, baseId, 'raw', name), 'utf8'))
      .sort()
    expect(copiedContents).toEqual(['A', 'B'])

    // The missing source is not copied, but its item is kept.
    expect(existsSync(path.join(knowledgeBaseDir, baseId, 'raw', 'missing.pdf'))).toBe(false)
    const warnings = (migrator as unknown as { warnings: string[] }).warnings
    expect(warnings.some((w) => w.includes('source missing') && w.includes('c.bin'))).toBe(true)
  })

  it('falls back to the storage name when a legacy file has a blank origin_name', async () => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'knowledge-file-copy-blank-'))
    const filesDataDir = path.join(tempRoot, 'Files')
    const knowledgeBaseDir = path.join(tempRoot, 'KnowledgeBase')
    mkdirSync(filesDataDir, { recursive: true })
    writeFileSync(path.join(filesDataDir, 'stored.bin'), 'Z')

    const dexieFiles: FileMetadata[] = [dexieFileRow({ id: 'fileZ', name: 'stored.bin', origin_name: '' })]
    const reduxKnowledge = {
      bases: [
        {
          id: 'kb-blank',
          name: 'KB Blank',
          dimensions: 1024,
          model: { id: 'emb', name: 'emb', provider: 'openai' },
          items: [{ id: 'item-z', type: 'file', content: 'fileZ' }]
        }
      ]
    }

    const ctx = makeCtx(dbh, dexieFiles, reduxKnowledge, { knowledgeBaseDir, filesDataDir })

    const migrator = new KnowledgeMigrator()
    expect((await migrator.prepare(ctx)).success).toBe(true)
    const baseId = (migrator as unknown as { preparedBases: { id: string }[] }).preparedBases[0].id
    expect((await migrator.execute(ctx)).success).toBe(true)

    const [row] = await dbh.db.select({ data: knowledgeItemTable.data }).from(knowledgeItemTable)
    const relativePath = (row.data as { relativePath: string }).relativePath
    // Falls back to the sanitized storage name (never blank).
    expect(relativePath).toBe('stored.bin')
    // The stored row survives the read path that lists items — a blank
    // relativePath would throw here and poison the whole base.
    expect(FileItemDataSchema.safeParse(row.data).success).toBe(true)
    // Copied to a real file under the base dir's `raw/` material root, not onto the base dir itself.
    expect(readFileSync(path.join(knowledgeBaseDir, baseId, 'raw', relativePath), 'utf8')).toBe('Z')
  })
})
