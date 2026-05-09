import { paintingTable } from '@data/db/schemas/painting'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { paintingService } from '../PaintingService'

describe('PaintingService', () => {
  const dbh = setupTestDatabase()

  async function insertModel(providerId = 'aihubmix', modelId = 'gpt-image-1') {
    const uniqueModelId = createUniqueModelId(providerId, modelId)
    await dbh.db.insert(userProviderTable).values({
      providerId,
      name: providerId
    })
    await dbh.db.insert(userModelTable).values({
      id: uniqueModelId,
      providerId,
      modelId,
      name: modelId
    })
    return uniqueModelId
  }

  it('assigns global order keys when creating paintings and inserts new items first', async () => {
    const first = await paintingService.create({
      providerId: 'aihubmix',
      mode: 'generate',
      prompt: 'first'
    })
    const second = await paintingService.create({
      providerId: 'aihubmix',
      mode: 'generate',
      prompt: 'second'
    })

    expect(first.orderKey).toBeTruthy()
    expect(first.orderKey > second.orderKey).toBe(true)

    const rows = await dbh.db.select().from(paintingTable).orderBy(asc(paintingTable.orderKey))
    expect(rows.map((row) => row.id)).toEqual([second.id, first.id])
  })

  it('uses one global order sequence across providers and modes', async () => {
    const generate = await paintingService.create({
      providerId: 'aihubmix',
      mode: 'generate',
      prompt: 'generate'
    })
    const edit = await paintingService.create({
      providerId: 'aihubmix',
      mode: 'edit',
      prompt: 'edit'
    })

    expect(generate.orderKey > edit.orderKey).toBe(true)

    const rows = await dbh.db.select().from(paintingTable).orderBy(asc(paintingTable.orderKey))
    expect(rows.map((row) => row.id)).toEqual([edit.id, generate.id])
  })

  it('lists filtered paintings ordered by global orderKey', async () => {
    const first = await paintingService.create({ providerId: 'aihubmix', mode: 'generate', prompt: 'first' })
    const second = await paintingService.create({ providerId: 'aihubmix', mode: 'generate', prompt: 'second' })
    await paintingService.create({ providerId: 'aihubmix', mode: 'edit', prompt: 'other mode' })

    const result = await paintingService.list({
      providerId: 'aihubmix',
      mode: 'generate',
      limit: 20,
      offset: 0
    })

    expect(result.items.map((item) => item.id)).toEqual([second.id, first.id])
    expect(result.total).toBe(2)
  })

  it('defaults new paintings to image media type', async () => {
    const painting = await paintingService.create({
      providerId: 'aihubmix',
      mode: 'generate',
      prompt: 'image'
    })

    expect(painting.mediaType).toBe('image')
  })

  it('declares nullable model references for painting history', async () => {
    const modelId = await insertModel()
    const painting = await paintingService.create({
      providerId: 'aihubmix',
      modelId,
      mode: 'generate',
      prompt: 'with model'
    })

    await dbh.db.delete(userModelTable).where(eq(userModelTable.id, modelId))

    const [stored] = await dbh.db.select().from(paintingTable).where(eq(paintingTable.id, painting.id)).limit(1)
    expect(stored.prompt).toBe('with model')
  })

  it('stores null for unknown model ids instead of failing FK insertion', async () => {
    const painting = await paintingService.create({
      providerId: 'aihubmix',
      modelId: createUniqueModelId('aihubmix', 'missing-model'),
      mode: 'generate',
      prompt: 'unknown model'
    })

    expect(painting.modelId).toBeNull()
  })

  it('creates, updates, and filters by video media type', async () => {
    const image = await paintingService.create({
      providerId: 'aihubmix',
      mode: 'generate',
      mediaType: 'image',
      prompt: 'image'
    })
    const video = await paintingService.create({
      providerId: 'aihubmix',
      mode: 'generate',
      mediaType: 'video',
      prompt: 'video'
    })

    const videos = await paintingService.list({
      providerId: 'aihubmix',
      mediaType: 'video',
      limit: 20,
      offset: 0
    })

    expect(videos.items.map((item) => item.id)).toEqual([video.id])
    expect(videos.total).toBe(1)

    const updated = await paintingService.update(image.id, { mediaType: 'video' })
    expect(updated.mediaType).toBe('video')
  })

  it("moves a painting to the first position via { position: 'first' }", async () => {
    const first = await paintingService.create({ providerId: 'aihubmix', mode: 'generate', prompt: 'first' })
    const second = await paintingService.create({ providerId: 'aihubmix', mode: 'generate', prompt: 'second' })
    const third = await paintingService.create({ providerId: 'aihubmix', mode: 'generate', prompt: 'third' })

    await paintingService.reorder(first.id, { position: 'first' })

    const result = await paintingService.list({
      providerId: 'aihubmix',
      mode: 'generate',
      limit: 20,
      offset: 0
    })
    expect(result.items.map((item) => item.id)).toEqual([first.id, third.id, second.id])
  })

  it('allows anchors across providers and modes', async () => {
    const generate = await paintingService.create({ providerId: 'aihubmix', mode: 'generate', prompt: 'generate' })
    const edit = await paintingService.create({ providerId: 'aihubmix', mode: 'edit', prompt: 'edit' })

    await paintingService.reorder(generate.id, { after: edit.id })

    const rows = await dbh.db.select().from(paintingTable).orderBy(asc(paintingTable.orderKey))
    expect(rows.map((row) => row.id)).toEqual([edit.id, generate.id])
  })

  it('applies batch moves against the global order', async () => {
    const first = await paintingService.create({ providerId: 'aihubmix', mode: 'generate', prompt: 'first' })
    const second = await paintingService.create({ providerId: 'aihubmix', mode: 'generate', prompt: 'second' })
    const third = await paintingService.create({ providerId: 'dmxapi', mode: 'edit', prompt: 'third' })

    await paintingService.reorderBatch([
      { id: third.id, anchor: { position: 'first' } },
      { id: first.id, anchor: { after: third.id } }
    ])

    const rows = await dbh.db.select().from(paintingTable).orderBy(asc(paintingTable.orderKey))
    expect(rows.map((row) => row.id)).toEqual([third.id, first.id, second.id])
  })
})
