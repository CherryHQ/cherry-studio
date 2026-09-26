import { setupTestDatabase } from '@test-helpers/db'
import { inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'
import { PreferenceSeeder } from '@data/db/seeding/seeders/preferenceSeeder'
import { BaseService } from '@main/core/lifecycle'
import { AgentHookListSchema } from '@shared/ai/agentHook'

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

  it('seeds empty global Hooks and restores saved rules from SQLite without overwriting them', async () => {
    const { PreferenceService } = await import('../PreferenceService')
    new PreferenceSeeder().run(dbh.db)
    const service = new PreferenceService()
    await service._doInit()
    expect(service.get('agent.hooks')).toEqual([])
    const hooks = AgentHookListSchema.parse([
      {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'global',
        event: 'preToolUse',
        command: 'exit 2',
        enabled: true,
        timeoutMs: 1000
      }
    ])
    await service.set('agent.hooks', hooks)
    new PreferenceSeeder().run(dbh.db)
    BaseService.resetInstances()
    const restored = new PreferenceService()
    await restored._doInit()
    expect(restored.get('agent.hooks')).toEqual(hooks)
    await restored.set('agent.hooks', [])
    const rows = dbh.db
      .select()
      .from(preferenceTable)
      .where(inArray(preferenceTable.key, ['agent.hooks']))
      .all()
    expect(rows).toMatchObject([{ scope: 'default', value: [] }])
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
