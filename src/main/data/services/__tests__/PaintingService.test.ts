import { fileEntryTable } from '@data/db/schemas/file'
import { paintingFileRefTable } from '@data/db/schemas/fileRelations'
import { paintingTable } from '@data/db/schemas/painting'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fileRefService } from '../FileRefService'
import { paintingService } from '../PaintingService'

describe('PaintingService', () => {
  const dbh = setupTestDatabase()

  function p(fields: {
    providerId: string
    prompt: string
    modelId?: string
    files?: { output: string[]; input: string[] }
  }) {
    return {
      files: { output: [], input: [] },
      ...fields
    }
  }

  beforeEach(() => {
    mockMainLoggerService.warn.mockClear()
  })

  async function insertModel(providerId = 'aihubmix', modelId = 'gpt-image-1') {
    const uniqueModelId = createUniqueModelId(providerId, modelId)
    const [providerOrderKey, modelOrderKey] = generateOrderKeySequence(2)
    await dbh.db.insert(userProviderTable).values({
      providerId,
      name: providerId,
      orderKey: providerOrderKey
    })
    await dbh.db.insert(userModelTable).values({
      id: uniqueModelId,
      providerId,
      modelId,
      name: modelId,
      orderKey: modelOrderKey
    })
    return uniqueModelId
  }

  async function seedFileEntry(id: string) {
    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'internal',
      name: 'n',
      ext: 'png',
      size: 1,
      externalPath: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now
    })
  }

  async function listPaintingRefs(sourceId: string) {
    return dbh.db
      .select()
      .from(paintingFileRefTable)
      .where(eq(paintingFileRefTable.sourceId, sourceId))
      .orderBy(asc(paintingFileRefTable.role), asc(paintingFileRefTable.fileEntryId))
  }

  it('assigns global order keys when creating paintings and inserts new items first', async () => {
    const first = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'first' }))
    const second = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'second' }))

    expect(first.orderKey).toBeTruthy()
    expect(first.orderKey > second.orderKey).toBe(true)

    const rows = await dbh.db.select().from(paintingTable).orderBy(asc(paintingTable.orderKey))
    expect(rows.map((row) => row.id)).toEqual([second.id, first.id])
  })

  it('uses one global order sequence across providers and modes', async () => {
    const generate = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'generate' }))
    const edit = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'edit' }))

    expect(generate.orderKey > edit.orderKey).toBe(true)

    const rows = await dbh.db.select().from(paintingTable).orderBy(asc(paintingTable.orderKey))
    expect(rows.map((row) => row.id)).toEqual([edit.id, generate.id])
  })

  it('filters paintings by providerId', async () => {
    const aihub = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'aihub' }))
    await paintingService.create(p({ providerId: 'dmxapi', prompt: 'dmxapi' }))

    const result = await paintingService.list({
      providerId: 'aihubmix',
      limit: 20
    })

    expect(result.items.map((item) => item.id)).toEqual([aihub.id])
    expect(result.total).toBe(1)
  })

  it('lists all paintings without filters', async () => {
    const first = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'first' }))
    const second = await paintingService.create(p({ providerId: 'dmxapi', prompt: 'second' }))

    const result = await paintingService.list({ limit: 20 })

    expect(result.items.map((item) => item.id)).toEqual([second.id, first.id])
    expect(result.total).toBe(2)
    expect(result.nextCursor).toBeUndefined()
  })

  it('declares nullable model references for painting history', async () => {
    const modelId = await insertModel()
    const painting = await paintingService.create(p({ providerId: 'aihubmix', modelId, prompt: 'with model' }))

    await dbh.db.delete(userModelTable).where(eq(userModelTable.id, modelId))

    const [stored] = await dbh.db.select().from(paintingTable).where(eq(paintingTable.id, painting.id)).limit(1)
    expect(stored.prompt).toBe('with model')
  })

  it('preserves model id regardless of whether it exists in user_model', async () => {
    const modelId = createUniqueModelId('aihubmix', 'missing-model')
    const painting = await paintingService.create(p({ providerId: 'aihubmix', modelId, prompt: 'unknown model' }))

    expect(painting.modelId).toBe(modelId)
  })

  it('clears stale model reference when provider changes without an explicit model', async () => {
    const modelId = await insertModel('aihubmix', 'gpt-image-1')
    const painting = await paintingService.create(p({ providerId: 'aihubmix', modelId, prompt: 'with model' }))

    const updated = await paintingService.update(painting.id, { providerId: 'zhipu' })

    expect(updated.providerId).toBe('zhipu')
    expect(updated.modelId).toBeNull()
  })

  it("moves a painting to the first position via { position: 'first' }", async () => {
    const first = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'first' }))
    const second = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'second' }))
    const third = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'third' }))

    await paintingService.reorder(first.id, { position: 'first' })

    const result = await paintingService.list({
      providerId: 'aihubmix',
      limit: 20
    })
    expect(result.items.map((item) => item.id)).toEqual([first.id, third.id, second.id])
  })

  it('paginates painting history with cursors', async () => {
    const first = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'first' }))
    const second = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'second' }))
    const third = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'third' }))

    const page1 = await paintingService.list({ providerId: 'aihubmix', limit: 2 })
    const page2 = await paintingService.list({
      providerId: 'aihubmix',
      limit: 2,
      cursor: page1.nextCursor
    })

    expect(page1.items.map((item) => item.id)).toEqual([third.id, second.id])
    expect(page1.nextCursor).toBe(`${second.orderKey}:${second.id}`)
    expect(page2.items.map((item) => item.id)).toEqual([first.id])
    expect(page2.nextCursor).toBeUndefined()
  })

  it('keysets across an order_key collision without skipping or repeating', async () => {
    // order_key is NOT unique at the DB level. Two paintings sharing one
    // order_key exercise the defensive (orderKey, id) tuple tiebreaker: a
    // single-key cursor (`gt(orderKey)`) would skip the second row at the page
    // boundary, whereas the tuple keysets deterministically. This test fails
    // under the old single-key cursor and passes under the tuple — proving the
    // tuple is collision-proof by construction.
    await dbh.db.insert(paintingTable).values([
      { id: 'collide-1', providerId: 'aihubmix', prompt: 'first', orderKey: 'a0' },
      { id: 'collide-2', providerId: 'aihubmix', prompt: 'second', orderKey: 'a0' }
    ])

    const page1 = await paintingService.list({ providerId: 'aihubmix', limit: 1 })
    expect(page1.items.map((item) => item.id)).toEqual(['collide-1'])
    expect(page1.nextCursor).toBe('a0:collide-1')

    const page2 = await paintingService.list({ providerId: 'aihubmix', limit: 1, cursor: page1.nextCursor })
    expect(page2.items.map((item) => item.id)).toEqual(['collide-2'])
    expect(page2.nextCursor).toBeUndefined()
  })

  it('allows anchors across providers and modes', async () => {
    const generate = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'generate' }))
    const edit = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'edit' }))

    await paintingService.reorder(generate.id, { after: edit.id })

    const rows = await dbh.db.select().from(paintingTable).orderBy(asc(paintingTable.orderKey))
    expect(rows.map((row) => row.id)).toEqual([edit.id, generate.id])
  })

  it('applies batch moves against the global order', async () => {
    const first = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'first' }))
    const second = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'second' }))
    const third = await paintingService.create(p({ providerId: 'dmxapi', prompt: 'third' }))

    await paintingService.reorderBatch([
      { id: third.id, anchor: { position: 'first' } },
      { id: first.id, anchor: { after: third.id } }
    ])

    const rows = await dbh.db.select().from(paintingTable).orderBy(asc(paintingTable.orderKey))
    expect(rows.map((row) => row.id)).toEqual([third.id, first.id, second.id])
  })

  it('routes painting writes through DbService.withWriteTx', async () => {
    const before = MockMainDbServiceUtils.getMockCallCounts().withWriteTx

    const painting = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'serialized writes' }))
    await paintingService.update(painting.id, { prompt: 'updated' })
    await paintingService.reorder(painting.id, { position: 'first' })
    await paintingService.reorderBatch([{ id: painting.id, anchor: { position: 'last' } }])
    await paintingService.delete(painting.id)

    expect(MockMainDbServiceUtils.getMockCallCounts().withWriteTx - before).toBe(5)
  })

  describe('file refs', () => {
    it('creates painting_file_ref rows for output and input files', async () => {
      const outputId = '019606a0-0000-7000-8000-00000000c101'
      const inputId = '019606a0-0000-7000-8000-00000000c102'
      await seedFileEntry(outputId)
      await seedFileEntry(inputId)

      const painting = await paintingService.create(
        p({ providerId: 'aihubmix', prompt: 'with files', files: { output: [outputId], input: [inputId] } })
      )

      expect(painting.files).toEqual({ output: [outputId], input: [inputId] })
      expect(await listPaintingRefs(painting.id)).toEqual([
        expect.objectContaining({ fileEntryId: inputId, sourceId: painting.id, role: 'input' }),
        expect.objectContaining({ fileEntryId: outputId, sourceId: painting.id, role: 'output' })
      ])
      await expect(paintingService.getById(painting.id)).resolves.toMatchObject({
        files: { output: [outputId], input: [inputId] }
      })
    })

    it('replaces painting_file_ref rows wholesale on update', async () => {
      const oldOutputId = '019606a0-0000-7000-8000-00000000c201'
      const oldInputId = '019606a0-0000-7000-8000-00000000c202'
      const newOutputId = '019606a0-0000-7000-8000-00000000c203'
      const newInputId = '019606a0-0000-7000-8000-00000000c204'
      for (const id of [oldOutputId, oldInputId, newOutputId, newInputId]) {
        await seedFileEntry(id)
      }
      const painting = await paintingService.create(
        p({ providerId: 'aihubmix', prompt: 'old files', files: { output: [oldOutputId], input: [oldInputId] } })
      )

      const updated = await paintingService.update(painting.id, {
        files: { output: [newOutputId], input: [newInputId] }
      })

      expect(updated.files).toEqual({ output: [newOutputId], input: [newInputId] })
      expect(await listPaintingRefs(painting.id)).toEqual([
        expect.objectContaining({ fileEntryId: newInputId, sourceId: painting.id, role: 'input' }),
        expect.objectContaining({ fileEntryId: newOutputId, sourceId: painting.id, role: 'output' })
      ])
      expect(await paintingService.getById(painting.id)).toMatchObject({
        files: { output: [newOutputId], input: [newInputId] }
      })
    })

    it('drops painting refs whose file_entry row is missing and warns without failing', async () => {
      const existingOutputId = '019606a0-0000-7000-8000-00000000c301'
      const missingOutputId = '019606a0-0000-7000-8000-00000000c302'
      const missingInputId = '019606a0-0000-7000-8000-00000000c303'
      await seedFileEntry(existingOutputId)

      const painting = await paintingService.create(
        p({
          providerId: 'aihubmix',
          prompt: 'dangling files',
          files: { output: [existingOutputId, missingOutputId], input: [missingInputId] }
        })
      )

      expect(await listPaintingRefs(painting.id)).toEqual([
        expect.objectContaining({ fileEntryId: existingOutputId, sourceId: painting.id, role: 'output' })
      ])
      expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
        'Dropped painting file refs without matching file_entry',
        expect.objectContaining({ paintingId: painting.id, dropped: 2, total: 3 })
      )
    })
  })

  describe('delete', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    async function paintingExists(id: string) {
      const rows = await dbh.db.select().from(paintingTable).where(eq(paintingTable.id, id))
      return rows.length === 1
    }

    it('removes the painting row and its file refs in one go', async () => {
      const fileEntryId = '019606a0-0000-7000-8000-111111111111'
      const painting = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'd1' }))
      await seedFileEntry(fileEntryId)
      const now = Date.now()
      await dbh.db.insert(paintingFileRefTable).values([
        { fileEntryId, sourceId: painting.id, role: 'output', createdAt: now, updatedAt: now },
        { fileEntryId, sourceId: painting.id, role: 'input', createdAt: now, updatedAt: now }
      ])

      await paintingService.delete(painting.id)

      expect(await paintingExists(painting.id)).toBe(false)
      expect(await fileRefService.findBySource({ sourceType: 'painting', sourceId: painting.id })).toEqual([])
    })

    it('succeeds when the painting has no file refs (today’s real path)', async () => {
      const painting = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'd3' }))

      await expect(paintingService.delete(painting.id)).resolves.toBeUndefined()
      expect(await paintingExists(painting.id)).toBe(false)
    })
  })
})
