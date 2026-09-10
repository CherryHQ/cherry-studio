import { preferenceTable } from '@data/db/schemas/preference'
import { PreferenceSeeder } from '@data/db/seeding/seeders/preferenceSeeder'
import { BaseService } from '@main/core/lifecycle'
import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@main/data/PreferenceService')

describe('PreferenceService compare-and-set', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    BaseService.resetInstances()
    new PreferenceSeeder().run(dbh.db)
  })

  it('rejects a stale window write without replacing the committed value', async () => {
    const { PreferenceService } = await import('../PreferenceService')
    const service = new PreferenceService()
    await service._doInit()
    const key = 'agent.session.hidden_builtin_ids'

    await expect(service.compareAndSet(key, [], ['cherry-support'])).resolves.toBe(true)
    await expect(service.compareAndSet(key, [], ['cherry-assistant'])).resolves.toBe(false)

    expect(service.get(key)).toEqual(['cherry-support'])
    const [persisted] = dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, key)))
      .all()
    expect(persisted.value).toEqual(['cherry-support'])
  })
})
