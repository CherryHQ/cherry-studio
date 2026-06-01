// Integration tests for `PaintingMigrator`, run against a real SQLite DB via
// `setupTestDatabase()` so the production migrations, FK constraints, and
// transaction semantics all apply.
//
// The riskiest (previously untested) path is the `file_ref` emission in
// `execute()`: legacy painting rows carry output/input `file_entry.id`s in
// JSON, but the FileMigrator may have skipped some of those ids as malformed.
// `execute()` resolves the referenced ids against `file_entry` and emits
// `file_ref` rows ONLY for ids that survived — dropping (and counting as
// `droppedFileRefs`) the dangling ones so the engine's final
// `PRAGMA foreign_key_check` never aborts the whole migration.
//
// `setupTestDatabase` keeps `foreign_keys = ON` (stricter than migration
// runtime, where the engine keeps them OFF until `verifyForeignKeys`). That's
// deliberate: if the dangling guard ever regresses, the FK constraint fires
// immediately on insert and `execute()` returns `success=false` — the same
// signal as the production check, just earlier.
import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { paintingTable } from '@data/db/schemas/painting'
import { paintingFileRefSchema, paintingSourceType } from '@shared/data/types/file/ref'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { PaintingMigrator } from '../PaintingMigrator'

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

// `painting.id` is a UUID v4 (the painting file-ref variant validates sourceId
// as `z.uuidv4()`), so seed realistic v4 ids even though `file_ref.sourceId`
// carries no FK constraint at the DB layer.
const PAINTING_OUTPUT_ID = '11111111-1111-4111-8111-111111111111'
const PAINTING_INPUT_ID = '22222222-2222-4222-8222-222222222222'
const PAINTING_DANGLING_ID = '33333333-3333-4333-8333-333333333333'

// `file_entry.id` is a UUID v7 (ordered) in production; any uuid-shaped string
// is accepted by the column. Use distinct ids for present vs. missing files.
const FILE_PRESENT_OUTPUT_ID = '019606a0-0000-7000-8000-000000000001'
const FILE_PRESENT_INPUT_ID = '019606a0-0000-7000-8000-000000000002'
const FILE_MISSING_A_ID = '019606a0-0000-7000-8000-0000000000aa'
const FILE_MISSING_B_ID = '019606a0-0000-7000-8000-0000000000bb'

type Dbh = ReturnType<typeof setupTestDatabase>

function makeCtx(dbh: Dbh, paintingsState: Record<string, unknown>) {
  // Only `sources.reduxState.getCategory` and `db` are consulted on this code
  // path; the full MigrationContext has more reader fields, so cast through
  // `never` and mock just what the migrator touches.
  return {
    sources: {
      reduxState: {
        getCategory: vi.fn((name: string) => (name === 'paintings' ? paintingsState : undefined))
      }
    },
    db: dbh.db
  } as never
}

async function seedInternalFile(dbh: Dbh, id: string): Promise<void> {
  const now = Date.now()
  await dbh.db.insert(fileEntryTable).values({
    id,
    origin: 'internal',
    name: 'image',
    ext: 'png',
    size: 1024,
    createdAt: now,
    updatedAt: now
  })
}

describe('PaintingMigrator file_ref integration', () => {
  const dbh = setupTestDatabase()

  it('emits file_ref rows for present file ids and inserts painting rows (happy path)', async () => {
    await seedInternalFile(dbh, FILE_PRESENT_OUTPUT_ID)
    await seedInternalFile(dbh, FILE_PRESENT_INPUT_ID)

    const migrator = new PaintingMigrator()
    const ctx = makeCtx(dbh, {
      // openai_image_edit carries both output (`files`) and input (`imageFile`).
      openai_image_edit: [
        {
          id: PAINTING_OUTPUT_ID,
          providerId: 'openai',
          prompt: 'edit a fox',
          files: [{ id: FILE_PRESENT_OUTPUT_ID }],
          imageFile: { id: FILE_PRESENT_INPUT_ID }
        }
      ]
    })

    expect((await migrator.prepare(ctx)).success).toBe(true)
    await expect(migrator.execute(ctx)).resolves.toMatchObject({ success: true, processedCount: 1 })

    const paintingRows = await dbh.db.select().from(paintingTable)
    expect(paintingRows).toHaveLength(1)
    expect(paintingRows[0]).toMatchObject({
      id: PAINTING_OUTPUT_ID,
      providerId: 'openai',
      prompt: 'edit a fox'
    })
    expect(paintingRows[0].orderKey).toEqual(expect.any(String))

    const refRows = await dbh.db.select().from(fileRefTable).where(eq(fileRefTable.sourceId, PAINTING_OUTPUT_ID))
    expect(refRows).toHaveLength(2)
    expect(refRows.every((r) => r.sourceType === paintingSourceType)).toBe(true)
    const byRole = new Map(refRows.map((r) => [r.role, r.fileEntryId]))
    expect(byRole.get('output')).toBe(FILE_PRESENT_OUTPUT_ID)
    expect(byRole.get('input')).toBe(FILE_PRESENT_INPUT_ID)

    // No dangling refs in the happy path.
    expect((migrator as unknown as { droppedFileRefs: number }).droppedFileRefs).toBe(0)

    // The post-migration check the engine runs must pass.
    const fkCheck = await dbh.client.execute('PRAGMA foreign_key_check')
    expect(fkCheck.rows).toHaveLength(0)
  })

  it('drops file ids absent from file_entry, counts them, and still migrates paintings', async () => {
    // Only the output id exists; the two referenced input ids were skipped by
    // the FileMigrator, so they are dangling.
    await seedInternalFile(dbh, FILE_PRESENT_OUTPUT_ID)

    const migrator = new PaintingMigrator()
    const ctx = makeCtx(dbh, {
      // One painting referencing a present output + a missing output.
      aihubmix_image_generate: [
        {
          id: PAINTING_OUTPUT_ID,
          prompt: 'a fox',
          files: [{ id: FILE_PRESENT_OUTPUT_ID }, { id: FILE_MISSING_A_ID }]
        }
      ],
      // One edit painting whose only input file is missing — the painting row
      // still migrates (input file is otherwise preserved as a ref), but the
      // dangling input ref is dropped.
      aihubmix_image_edit: [
        {
          id: PAINTING_INPUT_ID,
          prompt: 'edit it',
          imageFiles: [{ id: FILE_MISSING_B_ID }]
        }
      ]
    })

    expect((await migrator.prepare(ctx)).success).toBe(true)
    await expect(migrator.execute(ctx)).resolves.toMatchObject({ success: true, processedCount: 2 })

    // Both paintings persisted.
    const paintingRows = await dbh.db.select().from(paintingTable)
    expect(paintingRows.map((r) => r.id).sort()).toEqual([PAINTING_OUTPUT_ID, PAINTING_INPUT_ID].sort())

    // Only the present output id produced a file_ref; the two missing ids were
    // dropped (one output + one input).
    const refRows = await dbh.db.select().from(fileRefTable)
    expect(refRows).toHaveLength(1)
    expect(refRows[0]).toMatchObject({
      fileEntryId: FILE_PRESENT_OUTPUT_ID,
      sourceId: PAINTING_OUTPUT_ID,
      sourceType: paintingSourceType,
      role: 'output'
    })
    expect((migrator as unknown as { droppedFileRefs: number }).droppedFileRefs).toBe(2)

    // No dangling FK left behind for the engine's final check.
    const fkCheck = await dbh.client.execute('PRAGMA foreign_key_check')
    expect(fkCheck.rows).toHaveLength(0)
  })

  it('drops every ref and emits none when all referenced file ids are dangling', async () => {
    // No file_entry seeded at all → every referenced id is dangling.
    const migrator = new PaintingMigrator()
    const ctx = makeCtx(dbh, {
      siliconflow_paintings: [
        {
          id: PAINTING_DANGLING_ID,
          prompt: 'orphaned files',
          files: [{ id: FILE_MISSING_A_ID }, { id: FILE_MISSING_B_ID }]
        }
      ]
    })

    expect((await migrator.prepare(ctx)).success).toBe(true)
    await expect(migrator.execute(ctx)).resolves.toMatchObject({ success: true, processedCount: 1 })

    const paintingRows = await dbh.db.select().from(paintingTable)
    expect(paintingRows).toHaveLength(1)
    expect(paintingRows[0].id).toBe(PAINTING_DANGLING_ID)

    const refRows = await dbh.db.select().from(fileRefTable)
    expect(refRows).toHaveLength(0)
    expect((migrator as unknown as { droppedFileRefs: number }).droppedFileRefs).toBe(2)

    const fkCheck = await dbh.client.execute('PRAGMA foreign_key_check')
    expect(fkCheck.rows).toHaveLength(0)
  })

  it('rewrites a cross-namespace duplicate id to a fresh uuidv4 so file_refs validate', async () => {
    await seedInternalFile(dbh, FILE_PRESENT_OUTPUT_ID)
    await seedInternalFile(dbh, FILE_PRESENT_INPUT_ID)

    // Same legacy id in two namespaces → the second occurrence collides and
    // must be rewritten. The composite `${id}_${ns}_${i}` form used previously
    // is not a uuidv4, so its emitted file_ref would fail `paintingFileRefSchema`.
    const migrator = new PaintingMigrator()
    const ctx = makeCtx(dbh, {
      siliconflow_paintings: [{ id: PAINTING_OUTPUT_ID, prompt: 'first', files: [{ id: FILE_PRESENT_OUTPUT_ID }] }],
      dmxapi_paintings: [{ id: PAINTING_OUTPUT_ID, prompt: 'duplicate', files: [{ id: FILE_PRESENT_INPUT_ID }] }]
    })

    expect((await migrator.prepare(ctx)).success).toBe(true)
    await expect(migrator.execute(ctx)).resolves.toMatchObject({ success: true, processedCount: 2 })

    const paintingRows = await dbh.db.select().from(paintingTable)
    expect(paintingRows).toHaveLength(2)
    const ids = paintingRows.map((r) => r.id)
    // One row keeps the original id; the collision was rewritten to a distinct id.
    expect(new Set(ids).size).toBe(2)
    expect(ids).toContain(PAINTING_OUTPUT_ID)

    // Every emitted file_ref (including the rewritten sourceId) parses against
    // the painting ref schema, whose `sourceId` is `z.uuidv4()`.
    const refRows = await dbh.db.select().from(fileRefTable)
    expect(refRows).toHaveLength(2)
    for (const row of refRows) {
      expect(() => paintingFileRefSchema.parse(row)).not.toThrow()
    }
    expect(new Set(refRows.map((r) => r.sourceId))).toEqual(new Set(ids))

    const fkCheck = await dbh.client.execute('PRAGMA foreign_key_check')
    expect(fkCheck.rows).toHaveLength(0)
  })

  it('validates migrated row counts after a mixed present/dangling run', async () => {
    await seedInternalFile(dbh, FILE_PRESENT_OUTPUT_ID)

    const migrator = new PaintingMigrator()
    const ctx = makeCtx(dbh, {
      dmxapi_paintings: [
        { id: PAINTING_OUTPUT_ID, prompt: 'present', files: [{ id: FILE_PRESENT_OUTPUT_ID }] },
        { id: PAINTING_DANGLING_ID, prompt: 'dangling', files: [{ id: FILE_MISSING_A_ID }] }
      ]
    })

    await migrator.prepare(ctx)
    await migrator.execute(ctx)

    await expect(migrator.validate(ctx)).resolves.toMatchObject({
      success: true,
      stats: { sourceCount: 2, targetCount: 2, skippedCount: 0 }
    })
  })
})
