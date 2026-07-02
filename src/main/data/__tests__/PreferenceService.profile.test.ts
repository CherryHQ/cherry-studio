import { BaseService } from '@main/core/lifecycle'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { preferenceTable } from '../db/schemas/preference'
import type * as PreferenceServiceModule from '../PreferenceService'

// The real PreferenceService (globally mocked) driven against a real DB routed
// through setupTestDatabase: the DB-backed cache load runs on profile activation.
async function makeRealPreferenceService(): Promise<PreferenceServiceModule.PreferenceService> {
  const actual = await vi.importActual<typeof PreferenceServiceModule>('../PreferenceService')
  const svc = new actual.PreferenceService()
  await svc._doInit() // Ready; onInit does app-level setup only, no DB read
  return svc
}

describe('PreferenceService profile cache', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    BaseService.resetInstances()
  })

  it('loads the active profile cache on onProfileActivate', async () => {
    await dbh.db.insert(preferenceTable).values({ scope: 'default', key: 'agent.layout', value: 'modern' })
    const svc = await makeRealPreferenceService()

    // Before activation the cache serves defaults.
    expect(svc.get('agent.layout')).toBe(DefaultPreferences.default['agent.layout'])

    await svc.onProfileActivate()
    expect(svc.get('agent.layout')).toBe('modern')
  })

  it('errors on a profile-scoped read during the switch window (does not silently return the default)', async () => {
    await dbh.db.insert(preferenceTable).values({ scope: 'default', key: 'agent.layout', value: 'modern' })
    const svc = await makeRealPreferenceService()
    await svc.onProfileActivate()
    expect(svc.get('agent.layout')).toBe('modern')

    svc.onProfileDeactivate()
    // Reads during the switch must error, not hand back the app default as the active value.
    expect(() => svc.get('agent.layout')).toThrow(/profile switch/i)

    await svc.onProfileActivate()
    expect(svc.get('agent.layout')).toBe('modern')
  })

  it('does not retain a previous profile value absent from the new profile', async () => {
    await dbh.db.insert(preferenceTable).values({ scope: 'default', key: 'agent.layout', value: 'modern' })
    const svc = await makeRealPreferenceService()
    await svc.onProfileActivate()
    svc.onProfileDeactivate()

    await dbh.db.delete(preferenceTable) // new profile has no stored value
    await svc.onProfileActivate()
    expect(svc.get('agent.layout')).toBe(DefaultPreferences.default['agent.layout'])
  })

  it('re-notifies main-process subscribers with the new profile value on activate', async () => {
    await dbh.db.insert(preferenceTable).values({ scope: 'default', key: 'agent.layout', value: 'modern' })
    const svc = await makeRealPreferenceService()
    const listener = vi.fn()
    svc.subscribeChange('agent.layout', listener)

    await svc.onProfileActivate()
    // subscribeChange strips the key: the callback receives (newValue, oldValue).
    expect(listener).toHaveBeenCalledWith('modern', undefined)
  })
})
