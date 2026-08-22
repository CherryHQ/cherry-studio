/**
 * Guards the `reportsActualCost` provider capability flag: defaults to false,
 * and is set for OpenRouter (whose `usage.cost` is trusted over computed
 * pricing by the per-invocation usage record capture).
 */

import * as fs from 'node:fs'

import { describe, expect, it } from 'vitest'

import { ProviderListSchema } from '../schemas/provider'

describe('provider reportsActualCost', () => {
  it('defaults ordinary providers to false and declares OpenRouter as authoritative', () => {
    const raw = fs.readFileSync(new URL('../../data/providers.json', import.meta.url), 'utf-8')
    const { providers } = ProviderListSchema.parse(JSON.parse(raw))
    const openai = providers.find((p) => p.id === 'openai')
    const openrouter = providers.find((p) => p.id === 'openrouter')

    expect(openai?.reportsActualCost).toBe(false)
    expect(openrouter?.reportsActualCost).toBe(true)
    expect(openrouter?.reportedCostCurrency).toBe('USD')
  })
})
