import { describe, expect, it } from 'vitest'

import { doctorRequestSchemas } from '../doctor'

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
