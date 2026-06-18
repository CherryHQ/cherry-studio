import { describe, expect, it } from 'vitest'

import { TriggerSchema } from '../jobs'

describe('TriggerSchema', () => {
  it('accepts period triggers as a distinct persisted shape', () => {
    expect(
      TriggerSchema.parse({
        kind: 'period',
        period: 'weekly',
        time: '09:30',
        weekday: 1
      })
    ).toEqual({
      kind: 'period',
      period: 'weekly',
      time: '09:30',
      weekday: 1
    })
  })

  it('requires period trigger fields that match the cadence', () => {
    expect(TriggerSchema.safeParse({ kind: 'period', period: 'weekly', time: '09:30' }).success).toBe(false)
    expect(TriggerSchema.safeParse({ kind: 'period', period: 'monthly', time: '09:30' }).success).toBe(false)
    expect(TriggerSchema.safeParse({ kind: 'period', period: 'daily', time: '24:00' }).success).toBe(false)
  })
})
