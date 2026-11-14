import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'
import { BaseService } from '@main/core/lifecycle'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'

vi.unmock('@main/data/PreferenceService')

const KEY = 'feature.reasoning.effort_mappings' as const

// Regression coverage for the #21087 cross-window review finding: two detached
// Settings windows edit different mapping entries before either receives the
// other's broadcast. Whole-object writes from renderer snapshots lose one edit;
// entry updates applied in main must merge.
describe('PreferenceService.setReasoningEffortMappingEntry', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    BaseService.resetInstances()
    // A fresh service's cache starts as the module-level
    // DefaultPreferences.default object and set() writes through to it, so
    // reset this key to keep one test's edits out of the next test's start.
    DefaultPreferences.default[KEY] = {}
  })

  it('merges concurrent independent global entries from two windows', async () => {
    const { PreferenceService } = await import('../PreferenceService')
    const service = new PreferenceService()
    await service._doInit()

    await Promise.all([
      service.setReasoningEffortMappingEntry({ scope: 'global', source: 'low', target: 'medium' }),
      service.setReasoningEffortMappingEntry({ scope: 'global', source: 'high', target: 'low' })
    ])

    expect(service.get(KEY)).toEqual({ global: { low: 'medium', high: 'low' } })
  })

  it('applies an entry update against latest main state, not a stale renderer snapshot', async () => {
    const { PreferenceService } = await import('../PreferenceService')
    const service = new PreferenceService()
    await service._doInit()

    // Window A snapshots the value (as the old whole-object write path did),
    // window B commits first, then window A's entry update must not roll B's
    // edit back.
    await service.setReasoningEffortMappingEntry({ scope: 'global', source: 'low', target: 'medium' })
    await service.setReasoningEffortMappingEntry({ scope: 'global', source: 'high', target: 'low' })

    expect(service.get(KEY)).toEqual({ global: { low: 'medium', high: 'low' } })
  })

  it('merges concurrent edits to different providers and the global scope', async () => {
    const { PreferenceService } = await import('../PreferenceService')
    const service = new PreferenceService()
    await service._doInit()

    await Promise.all([
      service.setReasoningEffortMappingEntry({
        scope: 'provider',
        providerId: 'openai',
        source: 'low',
        target: 'medium'
      }),
      service.setReasoningEffortMappingEntry({
        scope: 'provider',
        providerId: 'anthropic',
        source: 'high',
        target: 'low'
      }),
      service.setReasoningEffortMappingEntry({ scope: 'global', source: 'minimal', target: 'low' })
    ])

    expect(service.get(KEY)).toEqual({
      global: { minimal: 'low' },
      providers: {
        openai: { default: { low: 'medium' } },
        anthropic: { default: { high: 'low' } }
      }
    })
  })

  it('clears an entry with a null target', async () => {
    const { PreferenceService } = await import('../PreferenceService')
    const service = new PreferenceService()
    await service._doInit()

    await service.setReasoningEffortMappingEntry({ scope: 'global', source: 'low', target: 'medium' })
    await service.setReasoningEffortMappingEntry({ scope: 'global', source: 'low', target: null })

    expect(service.get(KEY)).toEqual({})
  })

  it('persists merged entries to the database', async () => {
    // set() UPDATEs — production rows come from the preference seeder, so the
    // test seeds one like PreferenceService.setMultiple.test.ts does.
    dbh.db.insert(preferenceTable).values({ scope: 'default', key: KEY, value: {} }).run()
    const { PreferenceService } = await import('../PreferenceService')
    const service = new PreferenceService()
    await service._doInit()

    await service.setReasoningEffortMappingEntry({ scope: 'global', source: 'low', target: 'medium' })
    await service.setReasoningEffortMappingEntry({ scope: 'global', source: 'high', target: 'low' })

    const row = dbh.db.select().from(preferenceTable).where(eq(preferenceTable.key, KEY)).get()
    expect(row?.value).toEqual({ global: { low: 'medium', high: 'low' } })
  })
})
