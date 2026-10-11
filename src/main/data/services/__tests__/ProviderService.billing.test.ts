import '@data/services/ProviderRegistryService'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { CreateProviderSchema, UpdateProviderSchema } from '@shared/data/api/schemas/providers'
import type { ProviderBilling } from '@shared/data/types/providerBilling'

const billing: ProviderBilling = {
  defaultMultiplier: 2,
  scheduleEnabled: true,
  timeZone: '+08:00',
  periods: [{ id: 'night', name: 'Night', start: '22:00', end: '06:00', mode: 'multiplier', multiplier: 0.5 }]
}

describe('provider billing persistence', () => {
  const dbh = setupTestDatabase()

  it('preserves unrelated settings and disabled rules; reset removes only billing', () => {
    dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'group', name: 'Group', orderKey: 'a0', providerSettings: { timeout: 45 } })
      .run()
    providerService.update('group', UpdateProviderSchema.parse({ providerSettings: { billing } }))
    const disabled = providerService.update(
      'group',
      UpdateProviderSchema.parse({ providerSettings: { billing: { scheduleEnabled: false, defaultMultiplier: 0 } } })
    )
    expect(disabled.settings).toEqual({
      timeout: 45,
      billing: { ...billing, scheduleEnabled: false, defaultMultiplier: 0 }
    })
    const stored = dbh.db.select().from(userProviderTable).get()!
    expect(JSON.parse(JSON.stringify(stored.providerSettings))).toEqual(disabled.settings)
    expect(providerService.update('group', { providerSettings: { billing: null } }).settings).toEqual({ timeout: 45 })
  })

  it('validates the merged configuration atomically and replaces period parameters', () => {
    dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'group', name: 'Group', orderKey: 'a0', providerSettings: { billing } })
      .run()
    expect(() =>
      providerService.update('group', { name: 'Changed', providerSettings: { billing: { timeZone: null } } })
    ).toThrow()
    expect(providerService.getByProviderId('group')).toMatchObject({ name: 'Group', settings: { billing } })
    const models = [
      {
        modelId: 'model',
        pricing: {
          input: { perMillionTokens: 1, currency: 'CNY' as const },
          output: { perMillionTokens: 2, currency: 'CNY' as const }
        }
      }
    ]
    const period = { id: 'night', name: 'Night', start: '22:00', end: '06:00', mode: 'prices' as const, models }
    const updated = providerService.update('group', { providerSettings: { billing: { periods: [period] } } })
    expect(updated.settings.billing?.periods).toEqual([period])
    expect(
      providerService.update('group', { providerSettings: { billing: { periods: [] } } }).settings.billing?.periods
    ).toEqual([])
  })

  it('rejects overlapping creation and preserves billing on a new provider', () => {
    expect(() =>
      CreateProviderSchema.parse({
        providerId: 'invalid',
        name: 'Invalid',
        providerSettings: {
          billing: { ...billing, periods: [...billing.periods, { ...billing.periods[0], id: 'other' }] }
        }
      })
    ).toThrow()
    const created = providerService.create(
      CreateProviderSchema.parse({
        providerId: 'copy',
        name: 'Copy',
        providerSettings: { billing: structuredClone(billing) }
      })
    )
    expect(created.settings.billing).toEqual(billing)
    expect(dbh.db.select().from(userProviderTable).get()?.providerSettings?.billing).toEqual(billing)
  })
})
