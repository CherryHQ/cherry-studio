import { describe, expect, it } from 'vitest'

import { executionFailureSchema } from '@cherrystudio/remote-protocol/failure'

import { toExecutionFailure } from '../executionFailure'

describe('execution failure projection', () => {
  it('extracts a subscription rejection from CLI-style errors without confusing it with remote authorization', () => {
    const failure = toExecutionFailure(
      {
        name: 'Error',
        stack: '/Users/private/stack',
        message:
          '403: {"type":"server_error","message":"An active OpenCode Go subscription is required to use Go models.","token":"secret"}'
      },
      'opencode::deepseek-flash'
    )
    expect(failure).toMatchObject({
      message: 'An active OpenCode Go subscription is required to use Go models.',
      retryable: false,
      failure: {
        reasonCode: 'permission',
        source: { layer: 'provider' },
        context: { statusCode: 403, providerId: 'opencode' }
      }
    })
    expect(JSON.stringify(failure)).not.toMatch(/secret|private|stack/)
  })

  it('preserves an existing classification when provider payloads were already redacted', () => {
    expect(
      toExecutionFailure({
        name: 'APIError',
        message: 'Request rejected',
        stack: null,
        providerErrorCategory: 'region',
        statusCode: 403
      }).failure.reasonCode
    ).toBe('region')
  })

  it('keeps diagnostic bytes bounded and excludes credentials and local paths', () => {
    const failure = toExecutionFailure({
      name: 'Error',
      message: 'Cannot read /Users/alice/private/file; token=secret',
      stack: 'private',
      responseBody: null
    })
    expect(failure.message).not.toMatch(/alice|secret/)
    const large = toExecutionFailure({
      name: 'Error',
      message: '\u0001'.repeat(500),
      stack: null,
      providerId: '\u0001'.repeat(128),
      modelId: '\u0001'.repeat(128)
    })
    expect(executionFailureSchema.safeParse(large).success).toBe(true)
    expect(new TextEncoder().encode(JSON.stringify(large)).length).toBeLessThanOrEqual(4096)
  })
})
