import { resolve } from 'node:path'

import { readProviderModelRegistry } from '@cherrystudio/provider-registry/node'
import type { RuntimeModelPricing } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { resolveModelPricing } from '../modelPricing'

const basePricing = {
  input: { perMillionTokens: 1, currency: 'USD' as const },
  output: { perMillionTokens: 2, currency: 'USD' as const }
}

describe('resolveModelPricing', () => {
  it('uses half-open weekly windows in the declared timezone', () => {
    const pricing: RuntimeModelPricing = {
      ...basePricing,
      scheduled: {
        default: { input: { perMillionTokens: 0.5, currency: 'USD' } },
        rules: [
          {
            schedule: {
              kind: 'weekly',
              timezone: 'UTC',
              daysOfWeek: ['monday'],
              startTime: '01:00',
              endTime: '04:00'
            },
            pricing: { input: { perMillionTokens: 1, currency: 'USD' } }
          }
        ]
      }
    }

    expect(resolveModelPricing(pricing, new Date('2026-08-31T00:59:59.999Z')).input.perMillionTokens).toBe(0.5)
    expect(resolveModelPricing(pricing, new Date('2026-08-31T01:00:00.000Z')).input.perMillionTokens).toBe(1)
    expect(resolveModelPricing(pricing, new Date('2026-08-31T04:00:00.000Z')).input.perMillionTokens).toBe(0.5)
  })

  it('applies a later fixed adjustment over a matching recurring rate', () => {
    const pricing: RuntimeModelPricing = {
      ...basePricing,
      scheduled: {
        rules: [
          {
            schedule: { kind: 'weekly', timezone: 'UTC', daysOfWeek: ['monday'] },
            pricing: { input: { perMillionTokens: 3, currency: 'USD' } }
          },
          {
            schedule: {
              kind: 'fixed',
              startsAt: '2026-08-31T02:00:00.000Z',
              endsAt: '2026-08-31T03:00:00.000Z'
            },
            pricing: { output: { perMillionTokens: 0.25, currency: 'USD' } }
          }
        ]
      }
    }

    const resolvedPricing = resolveModelPricing(pricing, new Date('2026-08-31T02:30:00.000Z'))
    expect(resolvedPricing.input.perMillionTokens).toBe(3)
    expect(resolvedPricing.output.perMillionTokens).toBe(0.25)
  })

  it('carries a cross-midnight window into the next local day', () => {
    const pricing: RuntimeModelPricing = {
      ...basePricing,
      scheduled: {
        rules: [
          {
            schedule: {
              kind: 'weekly',
              timezone: 'Asia/Shanghai',
              daysOfWeek: ['friday'],
              startTime: '23:00',
              endTime: '02:00'
            },
            pricing: { input: { perMillionTokens: 3, currency: 'USD' } }
          }
        ]
      }
    }

    expect(resolveModelPricing(pricing, new Date('2026-09-04T17:59:59.999Z')).input.perMillionTokens).toBe(3)
    expect(resolveModelPricing(pricing, new Date('2026-09-04T18:00:00.000Z')).input.perMillionTokens).toBe(1)
  })

  it('resolves the real DeepSeek V4 schedule for weekday peak, weekday off-peak, and weekend', () => {
    const registry = readProviderModelRegistry(
      resolve(process.cwd(), 'packages/provider-registry/data/provider-models.json')
    )
    const pricing = registry.overrides.find(
      ({ providerId, modelId }) => providerId === 'deepseek' && modelId === 'deepseek-v4-flash'
    )?.pricing as RuntimeModelPricing | undefined
    if (!pricing) throw new Error('Missing DeepSeek V4 Flash pricing')

    expect(resolveModelPricing(pricing, new Date('2026-08-31T02:00:00.000Z')).input.perMillionTokens).toBe(0.44)
    expect(resolveModelPricing(pricing, new Date('2026-08-31T05:00:00.000Z')).input.perMillionTokens).toBe(0.22)
    expect(resolveModelPricing(pricing, new Date('2026-09-05T02:00:00.000Z')).input.perMillionTokens).toBe(0.22)
  })
})
