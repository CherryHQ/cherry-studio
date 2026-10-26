import { describe, expect, it } from 'vitest'

import {
  aiFailureSnapshotSchema,
  executionFailureSchema,
  type ExecutionFailure
} from '@cherrystudio/remote-protocol/failure'

import { getExecutionFailureCategory, toExecutionFailure } from '../executionFailure'

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

describe('getExecutionFailureCategory', () => {
  const baseline: ExecutionFailure = {
    message: '402 status code (no body)',
    retryable: false,
    failure: {
      version: 1,
      reasonCode: 'quota',
      source: { layer: 'provider' },
      context: { statusCode: 402 }
    }
  }

  it.each([
    ['auth', 'auth'],
    ['permission', 'permission'],
    ['region', 'region'],
    ['quota', 'quota'],
    ['rate_limit', 'rate_limit'],
    ['context_length', 'context_length'],
    ['network', 'network'],
    ['mcp', 'mcp'],
    ['parse', 'parse'],
    ['model_not_found', 'model'],
    ['payload_too_large', 'payload'],
    ['proxy_tls', 'proxy'],
    ['stream_interrupted', 'stream'],
    ['content_filter', 'content'],
    ['provider_unavailable', 'server'],
    ['timeout', undefined],
    ['invalid_input', undefined],
    ['tool_limit', undefined],
    ['tool_failed', undefined],
    ['internal', undefined],
    ['unknown', undefined]
  ] as const)('projects validated reason %s to %s', (reasonCode, category) => {
    expect(getExecutionFailureCategory({ ...baseline, failure: { ...baseline.failure, reasonCode } })).toBe(category)
  })

  it.each([undefined, { statusCode: 429 }])('uses the quota reason regardless of context %j', (context) => {
    expect(getExecutionFailureCategory({ ...baseline, failure: { ...baseline.failure, context } })).toBe('quota')
  })

  it.each([
    undefined,
    {},
    baseline.failure,
    { name: 'Error', message: baseline.message, stack: null, executionFailure: baseline },
    { message: baseline.message, failure: baseline.failure },
    { ...baseline, failure: { ...baseline.failure, version: 2 } },
    { ...baseline, failure: { ...baseline.failure, reasonCode: 'future_reason' } },
    { ...baseline, failure: { ...baseline.failure, source: { layer: 'future_layer' } } },
    { ...baseline, failure: { ...baseline.failure, context: { statusCode: 99 } } },
    { ...baseline, failure: { ...baseline.failure, context: { statusCode: 600 } } },
    { ...baseline, failure: { ...baseline.failure, context: { statusCode: 402.5 } } },
    { ...baseline, failure: { ...baseline.failure, context: { statusCode: '402' } } },
    { ...baseline, retryable: 'false' },
    { ...baseline, message: 'x'.repeat(1025) },
    { ...baseline, extra: true },
    { ...baseline, failure: { ...baseline.failure, extra: true } },
    { ...baseline, failure: { ...baseline.failure, source: { layer: 'provider', extra: true } } },
    { ...baseline, failure: { ...baseline.failure, context: { statusCode: 402, extra: true } } }
  ])('makes no decision for invalid envelopes (%#)', (value) => {
    expect(getExecutionFailureCategory(value)).toBeUndefined()
  })

  it('rejects multibyte envelopes exceeding the total byte budget even when individual fields pass', () => {
    const oversized = {
      ...baseline,
      message: '界'.repeat(1000),
      failure: { ...baseline.failure, context: { responseBody: '界'.repeat(1000) } }
    }
    expect(oversized.message.length).toBeLessThanOrEqual(1024)
    expect(aiFailureSnapshotSchema.safeParse(oversized.failure).success).toBe(true)
    expect(new TextEncoder().encode(JSON.stringify(oversized)).length).toBeGreaterThan(4096)
    expect(getExecutionFailureCategory(oversized)).toBeUndefined()
  })
})
