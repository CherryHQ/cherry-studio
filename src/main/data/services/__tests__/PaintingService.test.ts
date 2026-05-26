import { paintingTable } from '@data/db/schemas/painting'
import { paintingService } from '@data/services/PaintingService'
import type { CreatePainting } from '@shared/data/api/schemas/paintings'
import type { FileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

const file: FileMetadata = {
  id: 'file-1',
  name: 'file-1.png',
  origin_name: 'file-1.png',
  path: '/tmp/file-1.png',
  size: 10,
  ext: 'png',
  type: 'image',
  created_at: '2026-01-01T00:00:00.000Z',
  count: 1
}

function createDto(overrides: Partial<CreatePainting> = {}): CreatePainting {
  return {
    provider: 'aihubmix',
    mode: 'generate',
    urls: [],
    files: [],
    params: {},
    ...overrides
  }
}

describe('PaintingService', () => {
  const dbh = setupTestDatabase()

  it('creates and lists paintings by provider and mode', async () => {
    const created = await paintingService.create(
      createDto({
        model: 'gpt-image-1',
        prompt: 'paint a mountain',
        files: [file],
        params: { quality: 'high' }
      })
    )

    expect(created.provider).toBe('aihubmix')
    expect(created.files[0]?.id).toBe(file.id)
    expect(created.params).toEqual({ quality: 'high' })

    const result = await paintingService.list({ provider: 'aihubmix', mode: 'generate', page: 1, limit: 20 })
    expect(result.total).toBe(1)
    expect(result.items[0]?.id).toBe(created.id)
  })

  it('reports file usage from persisted files JSON', async () => {
    const created = await paintingService.create(createDto({ files: [file] }))

    const usage = await paintingService.getFileUsage(file.id)

    expect(usage).toEqual({
      fileId: file.id,
      paintingIds: [created.id],
      count: 1
    })
  })

  it('updates files and params without using file_ref', async () => {
    const created = await paintingService.create(createDto())

    const updated = await paintingService.update(created.id, {
      files: [file],
      params: { seed: '42' }
    })

    expect(updated.files[0]?.id).toBe(file.id)
    expect(updated.params).toEqual({ seed: '42' })

    const rows = await dbh.db.select().from(paintingTable)
    expect(rows[0]?.files).toHaveLength(1)
  })

  it('deletes a painting', async () => {
    const created = await paintingService.create(createDto())

    await paintingService.delete(created.id)

    const result = await paintingService.list({ page: 1, limit: 20 })
    expect(result.total).toBe(0)
  })
})
