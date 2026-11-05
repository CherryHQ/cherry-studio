import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'
import { BaseService } from '@main/core/lifecycle'

vi.unmock('@main/data/PreferenceService')

describe('model settings persistence across independent callers', () => {
  const dbh = setupTestDatabase()
  beforeEach(() => {
    BaseService.resetInstances()
    dbh.db
      .insert(preferenceTable)
      .values({
        scope: 'default',
        key: 'chat.model_settings',
        value: {
          'provider::a': { reasoning_effort: 'high', enableWebSearch: true },
          'provider::other': { enableWebSearch: false }
        }
      })
      .run()
  })

  it('persists field merges while prior notifications remain pending', async () => {
    const { PreferenceService } = await import('../PreferenceService')
    const service = new PreferenceService()
    await service._doInit()
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(service as any, 'notifyChange').mockImplementation(() => pending)
    const firstWindow = service.updateModelSettings('provider::a', { reasoning_effort: 'low' })
    const secondWindow = service.updateModelSettings('provider::a', { enableWebSearch: false })
    const otherModel = service.updateModelSettings('provider::b', { enableWebSearch: true })
    const expected = {
      'provider::a': { reasoning_effort: 'low', enableWebSearch: false },
      'provider::other': { enableWebSearch: false },
      'provider::b': { enableWebSearch: true }
    }
    expect(service.get('chat.model_settings')).toEqual(expected)
    expect(
      dbh.db.select().from(preferenceTable).where(eq(preferenceTable.key, 'chat.model_settings')).get()?.value
    ).toEqual(expected)
    release()
    await Promise.all([firstWindow, secondWindow, otherModel])
  })
})
