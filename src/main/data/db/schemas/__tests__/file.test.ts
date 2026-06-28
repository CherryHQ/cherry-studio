/**
 * DB-level integrity tests for `file_entry` / file association schemas.
 *
 * These exercise the SQLite CHECK constraints, global unique index on
 * `externalPath`, and CASCADE FK — all of which are runtime guards we rely on
 * beyond the Zod layer. Kept separate from Zod-level shape tests (see
 * `src/shared/data/types/__tests__/fileEntry.test.ts`).
 */

import { randomUUID } from 'node:crypto'

import { fileEntryTable } from '@data/db/schemas/file'
import { chatMessageFileRefTable, paintingFileRefTable } from '@data/db/schemas/fileRelations'
import { messageTable } from '@data/db/schemas/message'
import { paintingTable } from '@data/db/schemas/painting'
import { topicTable } from '@data/db/schemas/topic'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

const TS = 1700000000000

function uuidv7(): string {
  // Simplified v7-looking value sufficient for DB uniqueness; schema tests
  // don't re-validate the UUID version (that's the Zod layer's job).
  return `019606a0-0000-7000-8000-${randomUUID().slice(-12)}`
}

function baseInternal(overrides: Record<string, unknown> = {}) {
  return {
    id: uuidv7(),
    origin: 'internal',
    name: 'doc',
    ext: 'md',
    size: 100,
    externalPath: null,
    deletedAt: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  }
}

function baseExternal(path: string, overrides: Record<string, unknown> = {}) {
  return {
    id: uuidv7(),
    origin: 'external',
    name: 'report',
    ext: 'pdf',
    size: null,
    externalPath: path,
    deletedAt: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  }
}

describe('fileEntryTable — CHECK constraints', () => {
  const dbh = setupTestDatabase()

  it('accepts a valid internal entry (externalPath=null)', async () => {
    await expect(dbh.db.insert(fileEntryTable).values(baseInternal())).resolves.not.toThrow()
  })

  it('accepts a valid external entry (externalPath non-null)', async () => {
    await expect(dbh.db.insert(fileEntryTable).values(baseExternal('/Users/me/report.pdf'))).resolves.not.toThrow()
  })

  it('rejects internal entry with non-null externalPath (fe_origin_consistency)', async () => {
    await expect(dbh.db.insert(fileEntryTable).values(baseInternal({ externalPath: '/some/path' }))).rejects.toThrow()
  })

  it('rejects external entry with null externalPath (fe_origin_consistency)', async () => {
    await expect(
      dbh.db.insert(fileEntryTable).values(baseExternal('placeholder', { externalPath: null }))
    ).rejects.toThrow()
  })

  it('rejects unknown origin value (fe_origin_check)', async () => {
    await expect(dbh.db.insert(fileEntryTable).values(baseInternal({ origin: 'remote' }))).rejects.toThrow()
  })
})

describe('fileEntryTable — functional unique index on lower(externalPath)', () => {
  const dbh = setupTestDatabase()

  it('rejects two external entries with byte-identical externalPath', async () => {
    const sharedPath = '/Users/me/shared.pdf'
    await dbh.db.insert(fileEntryTable).values(baseExternal(sharedPath))
    await expect(dbh.db.insert(fileEntryTable).values(baseExternal(sharedPath))).rejects.toThrow()
  })

  it('rejects two external entries that case-collide under lower() — the functional unique index', async () => {
    // `fe_external_path_lower_unique_idx` is `UNIQUE(lower(externalPath))`.
    // On a case-sensitive FS `/Users/me/A.PDF` and `/Users/me/a.pdf` would
    // be distinct on-disk files, but the DB still forbids the second entry
    // — the application layer (`ensureExternalEntry`) is responsible for
    // resolving the FS-level reuse-or-throw decision via `fs.realpath`
    // before the INSERT.
    await dbh.db.insert(fileEntryTable).values(baseExternal('/Users/me/A.PDF'))
    await expect(dbh.db.insert(fileEntryTable).values(baseExternal('/Users/me/a.pdf'))).rejects.toThrow()
  })

  it('does not constrain internal entries (externalPath is null — SQLite NULLs are distinct in UNIQUE indexes, including functional ones)', async () => {
    await dbh.db.insert(fileEntryTable).values(baseInternal())
    await expect(dbh.db.insert(fileEntryTable).values(baseInternal())).resolves.not.toThrow()
  })
})

describe('fileEntryTable — fe_external_no_delete check', () => {
  const dbh = setupTestDatabase()

  it('rejects an external entry with non-null deletedAt', async () => {
    await expect(
      dbh.db.insert(fileEntryTable).values(baseExternal('/Users/me/will-not-trash.pdf', { deletedAt: TS }))
    ).rejects.toThrow()
  })

  it('allows internal entries to be trashed', async () => {
    await expect(dbh.db.insert(fileEntryTable).values(baseInternal({ deletedAt: TS }))).resolves.not.toThrow()
  })
})

describe('fileEntryTable — fe_size_internal_only check', () => {
  const dbh = setupTestDatabase()

  it('accepts internal size = 0 (empty file)', async () => {
    await expect(dbh.db.insert(fileEntryTable).values(baseInternal({ size: 0 }))).resolves.not.toThrow()
  })

  it('rejects internal with null size (internal size is required)', async () => {
    await expect(dbh.db.insert(fileEntryTable).values(baseInternal({ size: null }))).rejects.toThrow()
  })

  it('rejects internal with negative size', async () => {
    await expect(dbh.db.insert(fileEntryTable).values(baseInternal({ size: -1 }))).rejects.toThrow()
  })

  it('accepts external with null size', async () => {
    await expect(dbh.db.insert(fileEntryTable).values(baseExternal('/Users/me/report.pdf'))).resolves.not.toThrow()
  })

  it('rejects external with numeric size (external has no stored size)', async () => {
    await expect(
      dbh.db.insert(fileEntryTable).values(baseExternal('/Users/me/zero.pdf', { size: 0 }))
    ).rejects.toThrow()
    await expect(
      dbh.db.insert(fileEntryTable).values(baseExternal('/Users/me/big.pdf', { size: 12345 }))
    ).rejects.toThrow()
  })
})

describe('chatMessageFileRefTable — CASCADE FK', () => {
  const dbh = setupTestDatabase()

  async function seedMessage(id = randomUUID()) {
    const topicId = randomUUID()
    const rootId = randomUUID()
    await dbh.db.insert(topicTable).values({
      id: topicId,
      activeNodeId: id,
      orderKey: topicId,
      createdAt: TS,
      updatedAt: TS
    })
    await dbh.db.insert(messageTable).values([
      {
        id: rootId,
        parentId: null,
        topicId,
        role: 'root',
        data: { parts: [] },
        status: 'success',
        siblingsGroupId: 0,
        createdAt: TS,
        updatedAt: TS
      },
      {
        id,
        parentId: rootId,
        topicId,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'hello' }] },
        status: 'success',
        siblingsGroupId: 0,
        createdAt: TS,
        updatedAt: TS
      }
    ])
    return id
  }

  it('deleting a file_entry removes chat_message_file_ref rows via CASCADE', async () => {
    const entry = baseInternal()
    const messageId = await seedMessage()
    await dbh.db.insert(fileEntryTable).values(entry)

    await dbh.db.insert(chatMessageFileRefTable).values({
      id: randomUUID(),
      fileEntryId: entry.id,
      sourceId: messageId,
      role: 'attachment',
      createdAt: TS,
      updatedAt: TS
    })

    const beforeDelete = await dbh.db
      .select()
      .from(chatMessageFileRefTable)
      .where(eq(chatMessageFileRefTable.fileEntryId, entry.id))
    expect(beforeDelete).toHaveLength(1)

    await dbh.db.delete(fileEntryTable).where(eq(fileEntryTable.id, entry.id))

    const afterDelete = await dbh.db
      .select()
      .from(chatMessageFileRefTable)
      .where(eq(chatMessageFileRefTable.fileEntryId, entry.id))
    expect(afterDelete).toHaveLength(0)
  })

  it('deleting a message removes chat_message_file_ref rows via CASCADE', async () => {
    const entry = baseInternal()
    const messageId = await seedMessage()
    await dbh.db.insert(fileEntryTable).values(entry)
    await dbh.db.insert(chatMessageFileRefTable).values({
      id: randomUUID(),
      fileEntryId: entry.id,
      sourceId: messageId,
      role: 'attachment',
      createdAt: TS,
      updatedAt: TS
    })

    await dbh.db.delete(messageTable).where(eq(messageTable.id, messageId))

    const remaining = await dbh.db.select().from(chatMessageFileRefTable)
    expect(remaining).toHaveLength(0)
  })

  it('rejects chat_message_file_ref pointing to a non-existent file_entry', async () => {
    const messageId = await seedMessage()
    await expect(
      dbh.db.insert(chatMessageFileRefTable).values({
        id: randomUUID(),
        fileEntryId: uuidv7(),
        sourceId: messageId,
        role: 'attachment',
        createdAt: TS,
        updatedAt: TS
      })
    ).rejects.toThrow()
  })

  it('rejects chat_message_file_ref pointing to a non-existent message', async () => {
    const entry = baseInternal()
    await dbh.db.insert(fileEntryTable).values(entry)
    await expect(
      dbh.db.insert(chatMessageFileRefTable).values({
        id: randomUUID(),
        fileEntryId: entry.id,
        sourceId: randomUUID(),
        role: 'attachment',
        createdAt: TS,
        updatedAt: TS
      })
    ).rejects.toThrow()
  })

  it('rejects unsupported chat_message_file_ref roles', async () => {
    const entry = baseInternal()
    const messageId = await seedMessage()
    await dbh.db.insert(fileEntryTable).values(entry)
    await expect(
      dbh.db.insert(chatMessageFileRefTable).values({
        id: randomUUID(),
        fileEntryId: entry.id,
        sourceId: messageId,
        role: 'source',
        createdAt: TS,
        updatedAt: TS
      })
    ).rejects.toThrow()
  })
})

describe('paintingFileRefTable — CASCADE FK', () => {
  const dbh = setupTestDatabase()

  async function seedPainting(id = randomUUID()) {
    await dbh.db.insert(paintingTable).values({
      id,
      providerId: 'provider',
      modelId: null,
      prompt: 'prompt',
      orderKey: 'a0',
      createdAt: TS,
      updatedAt: TS
    })
    return id
  }

  it('deleting a file_entry removes painting_file_ref rows via CASCADE', async () => {
    const entry = baseInternal()
    const paintingId = await seedPainting()
    await dbh.db.insert(fileEntryTable).values(entry)

    await dbh.db.insert(paintingFileRefTable).values({
      id: randomUUID(),
      fileEntryId: entry.id,
      sourceId: paintingId,
      role: 'output',
      createdAt: TS,
      updatedAt: TS
    })

    const beforeDelete = await dbh.db
      .select()
      .from(paintingFileRefTable)
      .where(eq(paintingFileRefTable.fileEntryId, entry.id))
    expect(beforeDelete).toHaveLength(1)

    await dbh.db.delete(fileEntryTable).where(eq(fileEntryTable.id, entry.id))

    const afterDelete = await dbh.db
      .select()
      .from(paintingFileRefTable)
      .where(eq(paintingFileRefTable.fileEntryId, entry.id))
    expect(afterDelete).toHaveLength(0)
  })

  it('deleting a painting removes painting_file_ref rows via CASCADE', async () => {
    const entry = baseInternal()
    const paintingId = await seedPainting()
    await dbh.db.insert(fileEntryTable).values(entry)
    await dbh.db.insert(paintingFileRefTable).values({
      id: randomUUID(),
      fileEntryId: entry.id,
      sourceId: paintingId,
      role: 'output',
      createdAt: TS,
      updatedAt: TS
    })

    await dbh.db.delete(paintingTable).where(eq(paintingTable.id, paintingId))

    const remaining = await dbh.db.select().from(paintingFileRefTable)
    expect(remaining).toHaveLength(0)
  })

  it('rejects painting_file_ref pointing to a non-existent file_entry', async () => {
    const paintingId = await seedPainting()
    await expect(
      dbh.db.insert(paintingFileRefTable).values({
        id: randomUUID(),
        fileEntryId: uuidv7(),
        sourceId: paintingId,
        role: 'output',
        createdAt: TS,
        updatedAt: TS
      })
    ).rejects.toThrow()
  })
})

describe('paintingFileRefTable — unique constraint', () => {
  const dbh = setupTestDatabase()

  async function seedPainting(id = randomUUID()) {
    await dbh.db.insert(paintingTable).values({
      id,
      providerId: 'provider',
      modelId: null,
      prompt: 'prompt',
      orderKey: 'a0',
      createdAt: TS,
      updatedAt: TS
    })
    return id
  }

  it('rejects duplicate (fileEntryId, sourceId, role)', async () => {
    const entry = baseInternal()
    const paintingId = await seedPainting()
    await dbh.db.insert(fileEntryTable).values(entry)

    const refValues = {
      fileEntryId: entry.id,
      sourceId: paintingId,
      role: 'output',
      createdAt: TS,
      updatedAt: TS
    }

    await dbh.db.insert(paintingFileRefTable).values({ id: randomUUID(), ...refValues })
    await expect(dbh.db.insert(paintingFileRefTable).values({ id: randomUUID(), ...refValues })).rejects.toThrow()
  })

  it('allows multiple roles for the same (fileEntryId, sourceId)', async () => {
    const entry = baseInternal()
    const paintingId = await seedPainting()
    await dbh.db.insert(fileEntryTable).values(entry)

    const common = {
      fileEntryId: entry.id,
      sourceId: paintingId,
      createdAt: TS,
      updatedAt: TS
    }

    await dbh.db.insert(paintingFileRefTable).values({ id: randomUUID(), ...common, role: 'output' })
    await expect(
      dbh.db.insert(paintingFileRefTable).values({ id: randomUUID(), ...common, role: 'input' })
    ).resolves.not.toThrow()
  })
})
