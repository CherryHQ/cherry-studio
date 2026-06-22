import { creationTable } from '@data/db/schemas/creation'
import { fileEntryTable } from '@data/db/schemas/file'
import type { CreationKind } from '@shared/data/types/creation'
import { setupTestDatabase } from '@test-helpers/db'
import { asc, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { creationService } from '../CreationService'
import { fileRefService } from '../FileRefService'

describe('CreationService', () => {
  const dbh = setupTestDatabase()

  function c(fields: { kind: CreationKind; providerId: string; prompt: string; modelId?: string }) {
    return {
      files: { output: [], input: [] },
      ...fields
    }
  }

  it('assigns global order keys and inserts new items first', async () => {
    const first = await creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'first' }))
    const second = await creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'second' }))

    expect(first.orderKey > second.orderKey).toBe(true)
    const rows = await dbh.db.select().from(creationTable).orderBy(asc(creationTable.orderKey))
    expect(rows.map((row) => row.id)).toEqual([second.id, first.id])
  })

  it('persists and returns the kind discriminator', async () => {
    const image = await creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'img' }))
    const video = await creationService.create(c({ kind: 'video', providerId: 'dmxapi', prompt: 'vid' }))
    expect(image.kind).toBe('image')
    expect(video.kind).toBe('video')
  })

  it('filters by kind (the Creation page Image / Video tabs)', async () => {
    const image = await creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'img' }))
    const video = await creationService.create(c({ kind: 'video', providerId: 'dmxapi', prompt: 'vid' }))

    const images = await creationService.list({ kind: 'image', limit: 20 })
    const videos = await creationService.list({ kind: 'video', limit: 20 })

    expect(images.items.map((i) => i.id)).toEqual([image.id])
    expect(videos.items.map((i) => i.id)).toEqual([video.id])
    expect(images.total).toBe(1)
    expect(videos.total).toBe(1)
  })

  it('combines kind and providerId filters', async () => {
    await creationService.create(c({ kind: 'video', providerId: 'dmxapi', prompt: 'dmx' }))
    const ppio = await creationService.create(c({ kind: 'video', providerId: 'ppio', prompt: 'ppio' }))

    const result = await creationService.list({ kind: 'video', providerId: 'ppio', limit: 20 })
    expect(result.items.map((i) => i.id)).toEqual([ppio.id])
    expect(result.total).toBe(1)
  })

  it('lists all kinds when no kind filter is given (newest first)', async () => {
    const image = await creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'img' }))
    const video = await creationService.create(c({ kind: 'video', providerId: 'dmxapi', prompt: 'vid' }))

    const result = await creationService.list({ limit: 20 })
    expect(result.items.map((i) => i.id)).toEqual([video.id, image.id])
    expect(result.total).toBe(2)
  })

  it('preserves model id regardless of whether it exists in user_model', async () => {
    const creation = await creationService.create(
      c({ kind: 'video', providerId: 'dmxapi', modelId: 'dmxapi::happyhorse-1.0-t2v', prompt: 'm' })
    )
    expect(creation.modelId).toBe('dmxapi::happyhorse-1.0-t2v')
  })

  it('clears stale model reference when provider changes without an explicit model', async () => {
    const creation = await creationService.create(
      c({ kind: 'image', providerId: 'aihubmix', modelId: 'aihubmix::gpt-image-1', prompt: 'm' })
    )
    const updated = await creationService.update(creation.id, { providerId: 'zhipu' })
    expect(updated.providerId).toBe('zhipu')
    expect(updated.modelId).toBeNull()
  })

  it('paginates with cursors', async () => {
    const first = await creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'first' }))
    const second = await creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'second' }))
    const third = await creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'third' }))

    const page1 = await creationService.list({ kind: 'image', limit: 2 })
    const page2 = await creationService.list({ kind: 'image', limit: 2, cursor: page1.nextCursor })

    expect(page1.items.map((i) => i.id)).toEqual([third.id, second.id])
    expect(page1.nextCursor).toBe(second.orderKey)
    expect(page2.items.map((i) => i.id)).toEqual([first.id])
    expect(page2.nextCursor).toBeUndefined()
  })

  it("moves a creation to the first position via { position: 'first' }", async () => {
    const first = await creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'first' }))
    const second = await creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'second' }))
    const third = await creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'third' }))

    await creationService.reorder(first.id, { position: 'first' })

    const result = await creationService.list({ kind: 'image', limit: 20 })
    expect(result.items.map((i) => i.id)).toEqual([first.id, third.id, second.id])
  })

  describe('delete', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    async function seedFileEntry(id: string, ext: string) {
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

    async function creationExists(id: string) {
      const rows = await dbh.db.select().from(creationTable).where(eq(creationTable.id, id))
      return rows.length === 1
    }

    it('removes the creation row and its file refs in one go', async () => {
      const fileEntryId = '11111111-1111-4111-8111-111111111111'
      const creation = await creationService.create(c({ kind: 'video', providerId: 'dmxapi', prompt: 'd1' }))
      await seedFileEntry(fileEntryId, 'mp4')
      await fileRefService.createMany([
        { fileEntryId, sourceType: 'creation', sourceId: creation.id, role: 'output' },
        { fileEntryId, sourceType: 'creation', sourceId: creation.id, role: 'input' }
      ])

      await creationService.delete(creation.id)

      expect(await creationExists(creation.id)).toBe(false)
      expect(await fileRefService.findBySource({ sourceType: 'creation', sourceId: creation.id })).toEqual([])
    })

    it('hydrates output/input file refs on get', async () => {
      const outId = '33333333-3333-4333-8333-333333333333'
      const inId = '44444444-4444-4444-8444-444444444444'
      const creation = await creationService.create(c({ kind: 'video', providerId: 'dmxapi', prompt: 'refs' }))
      await seedFileEntry(outId, 'mp4')
      await seedFileEntry(inId, 'png')
      await fileRefService.createMany([
        { fileEntryId: outId, sourceType: 'creation', sourceId: creation.id, role: 'output' },
        { fileEntryId: inId, sourceType: 'creation', sourceId: creation.id, role: 'input' }
      ])

      const fetched = await creationService.getById(creation.id)
      expect(fetched.files).toEqual({ output: [outId], input: [inId] })
    })

    it('succeeds when the creation has no file refs', async () => {
      const creation = await creationService.create(c({ kind: 'image', providerId: 'aihubmix', prompt: 'd3' }))
      await expect(creationService.delete(creation.id)).resolves.toBeUndefined()
      expect(await creationExists(creation.id)).toBe(false)
    })
  })
})
