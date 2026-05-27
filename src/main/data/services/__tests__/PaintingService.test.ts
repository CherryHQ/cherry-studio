import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { paintingTable } from '@data/db/schemas/painting'
import { paintingService } from '@data/services/PaintingService'
import type { CreatePainting } from '@shared/data/api/schemas/paintings'
import { paintingSourceType } from '@shared/data/types/file'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

const fileEntryId = '550e8400-e29b-41d4-a716-446655440001'

async function insertFileEntry(dbh: ReturnType<typeof setupTestDatabase>) {
  await dbh.db.insert(fileEntryTable).values({
    id: fileEntryId,
    origin: 'internal',
    name: 'file-1',
    ext: 'png',
    size: 10,
    externalPath: null,
    deletedAt: null,
    createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
    updatedAt: Date.parse('2026-01-01T00:00:00.000Z')
  })
}

function createDto(overrides: Partial<CreatePainting> = {}): CreatePainting {
  return {
    provider: 'aihubmix',
    mode: 'generate',
    urls: [],
    fileEntryIds: [],
    params: {},
    ...overrides
  }
}

describe('PaintingService', () => {
  const dbh = setupTestDatabase()

  it('creates and lists paintings by provider and mode', async () => {
    await insertFileEntry(dbh)

    const created = await paintingService.create(
      createDto({
        id: '550e8400-e29b-41d4-a716-446655440010',
        model: 'gpt-image-1',
        prompt: 'paint a mountain',
        fileEntryIds: [fileEntryId],
        params: { quality: 'high' }
      })
    )

    expect(created.provider).toBe('aihubmix')
    expect(created.id).toBe('550e8400-e29b-41d4-a716-446655440010')
    expect(created.files[0]?.id).toBe(fileEntryId)
    expect(created.params).toEqual({ quality: 'high' })

    const result = await paintingService.list({ provider: 'aihubmix', mode: 'generate', page: 1, limit: 20 })
    expect(result.total).toBe(1)
    expect(result.items[0]?.id).toBe(created.id)

    const fileFiltered = await paintingService.list({ fileEntryId, page: 1, limit: 20 })
    expect(fileFiltered.items.map((painting) => painting.id)).toEqual([created.id])
  })

  it('reports file usage from file_ref', async () => {
    await insertFileEntry(dbh)

    const created = await paintingService.create(createDto({ fileEntryIds: [fileEntryId] }))

    const usage = await paintingService.getFileUsage(fileEntryId)

    expect(usage).toEqual({
      fileEntryId,
      paintingIds: [created.id],
      count: 1
    })
  })

  it('updates file refs and params', async () => {
    await insertFileEntry(dbh)

    const created = await paintingService.create(createDto())

    const updated = await paintingService.update(created.id, {
      fileEntryIds: [fileEntryId],
      params: { seed: '42' }
    })

    expect(updated.files[0]?.id).toBe(fileEntryId)
    expect(updated.params).toEqual({ seed: '42' })

    const rows = await dbh.db.select().from(paintingTable)
    expect(rows).toHaveLength(1)

    const refs = await dbh.db.select().from(fileRefTable)
    expect(refs).toMatchObject([
      {
        fileEntryId,
        sourceType: paintingSourceType,
        sourceId: created.id,
        role: 'image'
      }
    ])
  })

  it('reorders paintings within provider and mode', async () => {
    const first = await paintingService.create(
      createDto({ id: '550e8400-e29b-41d4-a716-446655440011', prompt: 'first' })
    )
    const second = await paintingService.create(
      createDto({ id: '550e8400-e29b-41d4-a716-446655440012', prompt: 'second' })
    )

    await paintingService.reorder({
      provider: 'aihubmix',
      mode: 'generate',
      ids: [second.id, first.id]
    })

    const result = await paintingService.list({ provider: 'aihubmix', mode: 'generate', page: 1, limit: 20 })
    expect(result.items.map((painting) => painting.id)).toEqual([second.id, first.id])
  })

  it('deletes a painting', async () => {
    await insertFileEntry(dbh)

    const created = await paintingService.create(createDto({ fileEntryIds: [fileEntryId] }))

    await paintingService.delete(created.id)

    const result = await paintingService.list({ page: 1, limit: 20 })
    expect(result.total).toBe(0)
    const refs = await dbh.db.select().from(fileRefTable).where(eq(fileRefTable.sourceType, paintingSourceType))
    expect(refs).toHaveLength(0)
  })
})
