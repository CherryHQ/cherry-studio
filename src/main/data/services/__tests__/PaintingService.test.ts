import { fileEntryTable } from '@data/db/schemas/file'
import { paintingTable } from '@data/db/schemas/painting'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { asc, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fileRefService } from '../FileRefService'
import { paintingService } from '../PaintingService'

describe('PaintingService', () => {
  const dbh = setupTestDatabase()

  function p(fields: { providerId: string; prompt: string; modelId?: string }) {
    return {
      files: { output: [], input: [] },
      ...fields
    }
  }

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
    expect(page1.nextCursor).toBe(second.orderKey)
    expect(page2.items.map((item) => item.id)).toEqual([first.id])
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

  describe('delete', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

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

    async function paintingExists(id: string) {
      const rows = await dbh.db.select().from(paintingTable).where(eq(paintingTable.id, id))
      return rows.length === 1
    }

    it('removes the painting row and its file refs in one go', async () => {
      const fileEntryId = '11111111-1111-4111-8111-111111111111'
      const painting = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'd1' }))
      await seedFileEntry(fileEntryId)
      await fileRefService.createMany([
        { fileEntryId, sourceType: 'painting', sourceId: painting.id, role: 'output' },
        { fileEntryId, sourceType: 'painting', sourceId: painting.id, role: 'input' }
      ])

      await paintingService.delete(painting.id)

      expect(await paintingExists(painting.id)).toBe(false)
      expect(await fileRefService.findBySource({ sourceType: 'painting', sourceId: painting.id })).toEqual([])
    })

    it('rolls back the painting delete if ref cleanup fails (single atomic boundary)', async () => {
      const fileEntryId = '22222222-2222-4222-8222-222222222222'
      const painting = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'd2' }))
      await seedFileEntry(fileEntryId)
      await fileRefService.createMany([{ fileEntryId, sourceType: 'painting', sourceId: painting.id, role: 'output' }])

      const spy = vi
        .spyOn(fileRefService, 'cleanupBySourceTx')
        .mockRejectedValue(new Error('synthetic ref-cleanup failure'))

      await expect(paintingService.delete(painting.id)).rejects.toThrow()

      expect(spy).toHaveBeenCalled()
      // Both writes share one transaction: the painting row must survive and
      // its refs must be untouched when the deref step throws.
      expect(await paintingExists(painting.id)).toBe(true)
      expect(await fileRefService.findBySource({ sourceType: 'painting', sourceId: painting.id })).toHaveLength(1)
    })

    it('succeeds when the painting has no file refs (today’s real path)', async () => {
      const painting = await paintingService.create(p({ providerId: 'aihubmix', prompt: 'd3' }))

      await expect(paintingService.delete(painting.id)).resolves.toBeUndefined()
      expect(await paintingExists(painting.id)).toBe(false)
    })
  })
})
