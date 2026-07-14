import { creationTable } from '@data/db/schemas/creation'
import { fileEntryTable } from '@data/db/schemas/file'
import { creationFileRefTable } from '@data/db/schemas/fileRelations'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import type { CreationKind } from '@shared/data/types/creation'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { creationService } from '../CreationService'
import { fileRefService } from '../FileRefService'

describe('CreationService', () => {
  const dbh = setupTestDatabase()

  function c(fields: {
    kind: CreationKind
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

  async function seedFileEntry(id: string, ext = 'png') {
    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'internal',
      name: 'n',
      ext,
      size: 1,
      externalPath: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now
    })
  }

  async function listCreationRefs(sourceId: string) {
    return dbh.db
      .select()
      .from(creationFileRefTable)
      .where(eq(creationFileRefTable.sourceId, sourceId))
      .orderBy(asc(creationFileRefTable.role), asc(creationFileRefTable.fileEntryId))
  }

  it('assigns global order keys when creating creations and inserts new items first', async () => {
    const first = creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'first' }))
    const second = creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'second' }))

    expect(first.orderKey).toBeTruthy()
    expect(first.orderKey > second.orderKey).toBe(true)

    const rows = await dbh.db.select().from(creationTable).orderBy(asc(creationTable.orderKey))
    expect(rows.map((row) => row.id)).toEqual([second.id, first.id])
  })

  it('uses one global order sequence across providers and modes', async () => {
    const generate = creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'generate' }))
    const edit = creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'edit' }))

    expect(generate.orderKey > edit.orderKey).toBe(true)

    const rows = await dbh.db.select().from(creationTable).orderBy(asc(creationTable.orderKey))
    expect(rows.map((row) => row.id)).toEqual([edit.id, generate.id])
  })

  it('persists and returns the kind discriminator', () => {
    const image = creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'img' }))
    const video = creationService.create(c({ kind: 'video', providerId: 'dmxapi', prompt: 'vid' }))
    expect(image.kind).toBe('image')
    expect(video.kind).toBe('video')
  })

  it('filters by kind (the Creation page Image / Video tabs)', () => {
    const image = creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'img' }))
    const video = creationService.create(c({ kind: 'video', providerId: 'dmxapi', prompt: 'vid' }))

    const images = creationService.list({ kind: 'image', limit: 20 })
    const videos = creationService.list({ kind: 'video', limit: 20 })

    expect(images.items.map((i) => i.id)).toEqual([image.id])
    expect(videos.items.map((i) => i.id)).toEqual([video.id])
    expect(images.total).toBe(1)
    expect(videos.total).toBe(1)
  })

  it('combines kind and providerId filters', () => {
    creationService.create(c({ kind: 'video', providerId: 'dmxapi', prompt: 'dmx' }))
    const ppio = creationService.create(c({ kind: 'video', providerId: 'ppio', prompt: 'ppio' }))

    const result = creationService.list({ kind: 'video', providerId: 'ppio', limit: 20 })
    expect(result.items.map((i) => i.id)).toEqual([ppio.id])
    expect(result.total).toBe(1)
  })

  it('lists all kinds when no kind filter is given (newest first)', () => {
    const image = creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'img' }))
    const video = creationService.create(c({ kind: 'video', providerId: 'dmxapi', prompt: 'vid' }))

    const result = creationService.list({ limit: 20 })
    expect(result.items.map((i) => i.id)).toEqual([video.id, image.id])
    expect(result.total).toBe(2)
    expect(result.nextCursor).toBeUndefined()
  })

  it('filters creations by providerId', () => {
    const aihub = creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'aihub' }))
    creationService.create(c({ kind: 'image', providerId: 'dmxapi', prompt: 'dmxapi' }))

    const result = creationService.list({
      providerId: 'aihubmix',
      limit: 20
    })

    expect(result.items.map((item) => item.id)).toEqual([aihub.id])
    expect(result.total).toBe(1)
  })

  it('declares nullable model references for creation history', async () => {
    const modelId = await insertModel()
    const creation = creationService.create(c({ kind: 'image', providerId: 'aihubmix', modelId, prompt: 'with model' }))

    await dbh.db.delete(userModelTable).where(eq(userModelTable.id, modelId))

    const [stored] = await dbh.db.select().from(creationTable).where(eq(creationTable.id, creation.id)).limit(1)
    expect(stored.prompt).toBe('with model')
  })

  it('preserves model id regardless of whether it exists in user_model', () => {
    const modelId = createUniqueModelId('aihubmix', 'missing-model')
    const creation = creationService.create(
      c({ kind: 'image', providerId: 'aihubmix', modelId, prompt: 'unknown model' })
    )

    expect(creation.modelId).toBe(modelId)
  })

  it('clears stale model reference when provider changes without an explicit model', async () => {
    const modelId = await insertModel('aihubmix', 'gpt-image-1')
    const creation = creationService.create(c({ kind: 'image', providerId: 'aihubmix', modelId, prompt: 'with model' }))

    const updated = creationService.update(creation.id, { providerId: 'zhipu' })

    expect(updated.providerId).toBe('zhipu')
    expect(updated.modelId).toBeNull()
  })

  it("moves a creation to the first position via { position: 'first' }", () => {
    const first = creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'first' }))
    const second = creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'second' }))
    const third = creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'third' }))

    creationService.reorder(first.id, { position: 'first' })

    const result = creationService.list({
      providerId: 'aihubmix',
      limit: 20
    })
    expect(result.items.map((item) => item.id)).toEqual([first.id, third.id, second.id])
  })

  it('paginates creation history with cursors', () => {
    const first = creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'first' }))
    const second = creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'second' }))
    const third = creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'third' }))

    const page1 = creationService.list({ providerId: 'aihubmix', limit: 2 })
    const page2 = creationService.list({
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
    // order_key is NOT unique at the DB level. Two creations sharing one
    // order_key exercise the defensive (orderKey, id) tuple tiebreaker: a
    // single-key cursor (`gt(orderKey)`) would skip the second row at the page
    // boundary, whereas the tuple keysets deterministically. This test fails
    // under the old single-key cursor and passes under the tuple — proving the
    // tuple is collision-proof by construction.
    await dbh.db.insert(creationTable).values([
      { id: 'collide-1', kind: 'image', providerId: 'aihubmix', prompt: 'first', orderKey: 'a0' },
      { id: 'collide-2', kind: 'image', providerId: 'aihubmix', prompt: 'second', orderKey: 'a0' }
    ])

    const page1 = creationService.list({ providerId: 'aihubmix', limit: 1 })
    expect(page1.items.map((item) => item.id)).toEqual(['collide-1'])
    expect(page1.nextCursor).toBe('a0:collide-1')

    const page2 = creationService.list({ providerId: 'aihubmix', limit: 1, cursor: page1.nextCursor })
    expect(page2.items.map((item) => item.id)).toEqual(['collide-2'])
    expect(page2.nextCursor).toBeUndefined()
  })

  it('allows anchors across providers and modes', async () => {
    const generate = creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'generate' }))
    const edit = creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'edit' }))

    creationService.reorder(generate.id, { after: edit.id })

    const rows = await dbh.db.select().from(creationTable).orderBy(asc(creationTable.orderKey))
    expect(rows.map((row) => row.id)).toEqual([edit.id, generate.id])
  })

  it('applies batch moves against the global order', async () => {
    const first = creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'first' }))
    const second = creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'second' }))
    const third = creationService.create(c({ kind: 'video', providerId: 'dmxapi', prompt: 'third' }))

    creationService.reorderBatch([
      { id: third.id, anchor: { position: 'first' } },
      { id: first.id, anchor: { after: third.id } }
    ])

    const rows = await dbh.db.select().from(creationTable).orderBy(asc(creationTable.orderKey))
    expect(rows.map((row) => row.id)).toEqual([third.id, first.id, second.id])
  })

  it('routes multi-statement creation writes through DbService.withWriteTx', () => {
    const before = MockMainDbServiceUtils.getMockCallCounts().withWriteTx

    const creation = creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'serialized writes' }))
    creationService.update(creation.id, { prompt: 'updated' })
    creationService.reorder(creation.id, { position: 'first' })
    creationService.reorderBatch([{ id: creation.id, anchor: { position: 'last' } }])
    creationService.delete(creation.id)

    // create/update compose multiple statements and reorder/reorderBatch are read-then-write, so
    // they route through withWriteTx (4). delete() is a single autocommit DELETE (the FK cascade
    // clears creation_file_ref rows) and no longer opens a transaction.
    expect(MockMainDbServiceUtils.getMockCallCounts().withWriteTx - before).toBe(4)
  })

  describe('file refs', () => {
    it('creates creation_file_ref rows for output and input files', async () => {
      const outputId = '019606a0-0000-7000-8000-00000000c101'
      const inputId = '019606a0-0000-7000-8000-00000000c102'
      await seedFileEntry(outputId)
      await seedFileEntry(inputId)

      const creation = creationService.create(
        c({
          kind: 'image',
          providerId: 'aihubmix',
          prompt: 'with files',
          files: { output: [outputId], input: [inputId] }
        })
      )

      expect(creation.files).toEqual({ output: [outputId], input: [inputId] })
      expect(await listCreationRefs(creation.id)).toEqual([
        expect.objectContaining({ fileEntryId: inputId, sourceId: creation.id, role: 'input' }),
        expect.objectContaining({ fileEntryId: outputId, sourceId: creation.id, role: 'output' })
      ])
      expect(creationService.getById(creation.id)).toMatchObject({
        files: { output: [outputId], input: [inputId] }
      })
    })

    it('replaces creation_file_ref rows wholesale on update', async () => {
      const oldOutputId = '019606a0-0000-7000-8000-00000000c201'
      const oldInputId = '019606a0-0000-7000-8000-00000000c202'
      const newOutputId = '019606a0-0000-7000-8000-00000000c203'
      const newInputId = '019606a0-0000-7000-8000-00000000c204'
      for (const id of [oldOutputId, oldInputId, newOutputId, newInputId]) {
        await seedFileEntry(id)
      }
      const creation = creationService.create(
        c({
          kind: 'image',
          providerId: 'aihubmix',
          prompt: 'old files',
          files: { output: [oldOutputId], input: [oldInputId] }
        })
      )

      const updated = creationService.update(creation.id, {
        files: { output: [newOutputId], input: [newInputId] }
      })

      expect(updated.files).toEqual({ output: [newOutputId], input: [newInputId] })
      expect(await listCreationRefs(creation.id)).toEqual([
        expect.objectContaining({ fileEntryId: newInputId, sourceId: creation.id, role: 'input' }),
        expect.objectContaining({ fileEntryId: newOutputId, sourceId: creation.id, role: 'output' })
      ])
      expect(creationService.getById(creation.id)).toMatchObject({
        files: { output: [newOutputId], input: [newInputId] }
      })
    })

    it('drops creation refs whose file_entry row is missing and warns without failing', async () => {
      const existingOutputId = '019606a0-0000-7000-8000-00000000c301'
      const missingOutputId = '019606a0-0000-7000-8000-00000000c302'
      const missingInputId = '019606a0-0000-7000-8000-00000000c303'
      await seedFileEntry(existingOutputId)

      const creation = creationService.create(
        c({
          kind: 'image',
          providerId: 'aihubmix',
          prompt: 'dangling files',
          files: { output: [existingOutputId, missingOutputId], input: [missingInputId] }
        })
      )

      expect(await listCreationRefs(creation.id)).toEqual([
        expect.objectContaining({ fileEntryId: existingOutputId, sourceId: creation.id, role: 'output' })
      ])
      expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
        'Dropped creation file refs without matching file_entry',
        expect.objectContaining({ creationId: creation.id, dropped: 2, total: 3 })
      )
    })
  })

  describe('delete', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    async function creationExists(id: string) {
      const rows = await dbh.db.select().from(creationTable).where(eq(creationTable.id, id))
      return rows.length === 1
    }

    it('removes the creation row and its file refs in one go', async () => {
      const fileEntryId = '019606a0-0000-7000-8000-111111111111'
      const creation = creationService.create(c({ kind: 'video', providerId: 'dmxapi', prompt: 'd1' }))
      await seedFileEntry(fileEntryId, 'mp4')
      const now = Date.now()
      await dbh.db.insert(creationFileRefTable).values([
        { fileEntryId, sourceId: creation.id, role: 'output', createdAt: now, updatedAt: now },
        { fileEntryId, sourceId: creation.id, role: 'input', createdAt: now, updatedAt: now }
      ])

      creationService.delete(creation.id)

      expect(await creationExists(creation.id)).toBe(false)
      expect(fileRefService.findBySource({ sourceType: 'creation', sourceId: creation.id })).toEqual([])
    })

    it('succeeds when the creation has no file refs (today’s real path)', async () => {
      const creation = creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'd3' }))

      expect(creationService.delete(creation.id)).toBeUndefined()
      expect(await creationExists(creation.id)).toBe(false)
    })
  })
})
