import { preferenceTable } from '@data/db/schemas/preference'
import { BaseService } from '@main/core/lifecycle'
import { setupTestDatabase } from '@test-helpers/db'
import { inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@main/data/PreferenceService')

const FIRST_NULLABLE_KEY = 'chat.default_model_id' as const
const SECOND_NULLABLE_KEY = 'data.export.markdown.path' as const

describe('PreferenceService.setMultiple', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    BaseService.resetInstances()
    dbh.db
      .insert(preferenceTable)
      .values([
        { scope: 'default', key: FIRST_NULLABLE_KEY, value: 'first' },
        { scope: 'default', key: SECOND_NULLABLE_KEY, value: 'second' }
      ])
      .run()
  })

  it('accepts null values for nullable preference keys', async () => {
    const { PreferenceService } = await import('../PreferenceService')
    const service = new PreferenceService()
    await service._doInit()

    await service.setMultiple({
      [FIRST_NULLABLE_KEY]: null,
      [SECOND_NULLABLE_KEY]: null
    })

    const rows = dbh.db
      .select({ key: preferenceTable.key, value: preferenceTable.value })
      .from(preferenceTable)
      .where(inArray(preferenceTable.key, [FIRST_NULLABLE_KEY, SECOND_NULLABLE_KEY]))
      .all()
    expect(Object.fromEntries(rows.map(({ key, value }) => [key, value]))).toEqual({
      [FIRST_NULLABLE_KEY]: null,
      [SECOND_NULLABLE_KEY]: null
    })
  })
})
