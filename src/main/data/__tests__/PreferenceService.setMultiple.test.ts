import { preferenceTable } from '@data/db/schemas/preference'
import { BaseService } from '@main/core/lifecycle'
import { setupTestDatabase } from '@test-helpers/db'
import { inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@main/data/PreferenceService')

const IMAGE_PROCESSOR_KEY = 'feature.file_processing.default_image_to_text' as const
const DOCUMENT_PROCESSOR_KEY = 'feature.file_processing.default_document_to_markdown' as const

describe('PreferenceService.setMultiple', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    BaseService.resetInstances()
    dbh.db
      .insert(preferenceTable)
      .values([
        { scope: 'default', key: IMAGE_PROCESSOR_KEY, value: 'local-paddleocr' },
        { scope: 'default', key: DOCUMENT_PROCESSOR_KEY, value: 'local-document' }
      ])
      .run()
  })

  it('atomically accepts null for nullable preference keys', async () => {
    const { PreferenceService } = await import('../PreferenceService')
    const service = new PreferenceService()
    await service._doInit()

    await service.setMultiple({
      [IMAGE_PROCESSOR_KEY]: null,
      [DOCUMENT_PROCESSOR_KEY]: null
    })

    const rows = dbh.db
      .select({ key: preferenceTable.key, value: preferenceTable.value })
      .from(preferenceTable)
      .where(inArray(preferenceTable.key, [IMAGE_PROCESSOR_KEY, DOCUMENT_PROCESSOR_KEY]))
      .all()
    expect(Object.fromEntries(rows.map(({ key, value }) => [key, value]))).toEqual({
      [IMAGE_PROCESSOR_KEY]: null,
      [DOCUMENT_PROCESSOR_KEY]: null
    })
  })
})
