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

describe('Connectivity RPC boundary', () => {
  it('requires a contextual subject and caller-known run UUID for cancellation', () => {
    const schema = doctorRequestSchemas['diagnostics.doctor.connectivity'].input
    const runId = 'd7a3d7c3-a52a-4a6b-86ef-4ce33f8358a9'
    expect(schema.safeParse({ runId, subject: { kind: 'global' } }).success).toBe(false)
    expect(schema.safeParse({ subject: { kind: 'agent', agentId: 'agent' } }).success).toBe(false)
    expect(
      schema.parse({ runId, subject: { kind: 'chat', providerId: 'provider', modelId: 'model' } }).subject.kind
    ).toBe('chat')
  })
})
