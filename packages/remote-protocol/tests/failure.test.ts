import { describe, expect, it } from 'vitest'

import { executionSchema, messageSchema } from '../src/agent'

const failure = {
  message: 'An active OpenCode Go subscription is required to use Go models.',
  retryable: false,
  failure: { version: 1, reasonCode: 'permission', source: { layer: 'provider' }, context: { statusCode: 403 } }
}

describe('Agent failure contract', () => {
  const message = { messageId: 'm', revision: '1', role: 'assistant', partIds: [] }

  it('requires explicit message outcomes and an error summary even without parts', () => {
    expect(messageSchema.safeParse(message).success).toBe(false)
    expect(messageSchema.safeParse({ ...message, status: 'error' }).success).toBe(false)
    expect(messageSchema.parse({ ...message, status: 'error', failure })).toMatchObject({ status: 'error', failure })
    expect(messageSchema.safeParse({ ...message, status: 'success', failure }).success).toBe(false)
  })

  it('requires a message and a persistence outcome before declaring an execution terminal', () => {
    const execution = { executionId: 'e', status: 'failed', durable: true }
    expect(executionSchema.safeParse(execution).success).toBe(false)
    expect(executionSchema.safeParse({ ...execution, failure, messageId: 'm' }).success).toBe(false)
    expect(
      executionSchema.parse({
        ...execution,
        failure,
        messageId: 'm',
        history: { historyRevision: '2', messageRevision: '2' }
      })
    ).toMatchObject({ failure, messageId: 'm', durable: true })
  })
})
