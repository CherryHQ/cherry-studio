/**
 * Guards the `reportsActualCost` provider capability flag: defaults to false,
 * and is set for OpenRouter (whose `usage.cost` is trusted over computed
 * pricing). See `enrichStatsWithCost` in the app.
 */

import * as fs from 'node:fs'

import { describe, expect, it } from 'vitest'

import { ApiFeaturesSchema, ProviderListSchema } from '../schemas/provider'

describe('ApiFeaturesSchema.reportsActualCost', () => {
  it('defaults to false', () => {
    expect(ApiFeaturesSchema.parse({}).reportsActualCost).toBe(false)
  })

  it('is true for OpenRouter in providers.json', () => {
    const raw = fs.readFileSync(new URL('../../data/providers.json', import.meta.url), 'utf-8')
    const { providers } = ProviderListSchema.parse(JSON.parse(raw))
    const openrouter = providers.find((p) => p.id === 'openrouter')
    expect(openrouter?.apiFeatures?.reportsActualCost).toBe(true)
  })
})
