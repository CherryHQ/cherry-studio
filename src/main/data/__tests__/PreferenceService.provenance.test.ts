import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'
import { BaseService } from '@main/core/lifecycle'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'

import { PreferenceService } from '../PreferenceService'

vi.unmock('@main/data/PreferenceService')

const DEVELOPER_KEY = 'app.developer_mode.enabled' as const

describe('PreferenceService.getWithProvenance', () => {
  const dbh = setupTestDatabase()
  let service: PreferenceService

  beforeEach(() => {
    BaseService.resetInstances()
    service = new PreferenceService()
  })

  afterEach(async () => {
    if (service.isReady) await service._doDestroy()
  })

  it('reports not-ready before initialization instead of masquerading as the configured value', () => {
    const read = service.getWithProvenance(DEVELOPER_KEY)
    expect(read.provenance).toBe('not-ready')
    expect(read.value).toBe(false)
  })

  it('reports cache for a ready read of an unset key (affirmative default)', async () => {
    await service._doInit()
    const read = service.getWithProvenance(DEVELOPER_KEY)
    expect(read.provenance).toBe('cache')
    expect(read.value).toBe(false)
  })

  it('reports cache with the stored value for a ready read of a set key', async () => {
    dbh.db.insert(preferenceTable).values({ scope: 'default', key: DEVELOPER_KEY, value: true }).run()
    await service._doInit()
    const read = service.getWithProvenance(DEVELOPER_KEY)
    expect(read.provenance).toBe('cache')
    expect(read.value).toBe(true)
  })

  it('reports default for a key outside the default schema', async () => {
    await service._doInit()
    const read = service.getWithProvenance('no.such.preference.key' as UnifiedPreferenceKeyType)
    expect(read.provenance).toBe('default')
  })
})
