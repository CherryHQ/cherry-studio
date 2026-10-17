import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { preferenceTable } from '@data/db/schemas/preference'

const platformMock = vi.hoisted(() => ({ isDev: false }))

vi.mock('@main/core/platform', () => ({
  get isDev() {
    return platformMock.isDev
  }
}))

import { isDeveloperModeEnabledAtStartup, isMainNetworkDevtoolsEnabled } from '../isMainNetworkDevtoolsEnabled'

describe('isMainNetworkDevtoolsEnabled', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    platformMock.isDev = false
    vi.spyOn(application, 'getPath').mockImplementation((key: string) => {
      if (key === 'app.database.file') return dbh.sqlite.name
      throw new Error(`unexpected path key: ${key}`)
    })
  })

  it('is enabled in development builds', () => {
    platformMock.isDev = true
    expect(isMainNetworkDevtoolsEnabled()).toBe(true)
  })

  it('reads developer mode from the preference table at startup', async () => {
    await dbh.db.insert(preferenceTable).values({
      scope: 'default',
      key: 'app.developer_mode.enabled',
      value: true
    })

    expect(isDeveloperModeEnabledAtStartup()).toBe(true)
    expect(isMainNetworkDevtoolsEnabled()).toBe(true)
  })

  it('returns false when developer mode is disabled and not in development', async () => {
    await dbh.db.insert(preferenceTable).values({
      scope: 'default',
      key: 'app.developer_mode.enabled',
      value: false
    })

    expect(isDeveloperModeEnabledAtStartup()).toBe(false)
    expect(isMainNetworkDevtoolsEnabled()).toBe(false)
  })
})
