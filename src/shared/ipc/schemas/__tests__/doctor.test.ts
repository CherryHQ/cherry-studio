import { describe, expect, it } from 'vitest'

import { doctorRequestSchemas } from '../doctor'

const run = doctorRequestSchemas['diagnostics.doctor.run'].input

describe('Doctor subject boundary', () => {
  it('rejects missing and incomplete subjects instead of starting global diagnostics', () => {
    for (const subject of [undefined, null, { kind: 'chat', providerId: 'openai' }, { kind: 'agent', agentId: '' }]) {
      expect(run.safeParse({ tier: 'quick', subject }).success).toBe(false)
    }
    expect(run.parse({ tier: 'quick', subject: { kind: 'global' } })).toEqual({
      tier: 'quick',
      subject: { kind: 'global' }
    })
  })
})
