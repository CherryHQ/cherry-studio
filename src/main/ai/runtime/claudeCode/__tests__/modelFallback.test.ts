import { describe, expect, it } from 'vitest'

import type { RetryPolicy } from '../../aiSdk'
import { classifyFallbackEligibleError, resolveAgentSessionFallback, selectFallbackModelId } from '../modelFallback'
import { ClaudeCodeResultError } from '../streamAdapter'

const CURRENT_MODEL = 'claude-code::sonnet'

function policy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return {
    enabled: true,
    maxAttempts: 3,
    backoffEnabled: true,
    fallbackModelIds: ['other-provider::haiku'],
    ...overrides
  }
}

describe('classifyFallbackEligibleError', () => {
  it('admits result errors carrying a retryable api_error_status', () => {
    for (const status of [429, 500, 502, 503, 529]) {
      const error = new ClaudeCodeResultError('API Error', 'success', ['API Error'], 'api_error', status)
      expect(classifyFallbackEligibleError(error)).toBe(`http ${status}`)
    }
  })

  it('rejects non-retryable api_error_status values such as auth failures', () => {
    const error = new ClaudeCodeResultError('API Error', 'success', ['API Error'], 'api_error', 401)
    expect(classifyFallbackEligibleError(error)).toBeUndefined()
  })

  it('admits api_error terminal reasons whose diagnostic text carries a retryable status', () => {
    const error = new ClaudeCodeResultError(
      'API Error: 429 {"type":"rate_limit_error"}',
      'error_during_execution',
      ['API Error: 429 {"type":"rate_limit_error"}'],
      'api_error'
    )
    expect(classifyFallbackEligibleError(error)).toBe('http 429')
  })

  it('admits api_error terminal reasons whose text names the limit without a status code', () => {
    const error = new ClaudeCodeResultError(
      'API Error: You have exceeded your quota.',
      'error_during_execution',
      ['API Error: You have exceeded your quota.'],
      'api_error'
    )
    expect(classifyFallbackEligibleError(error)).toBe('API Error: You have exceeded your quota.')
  })

  it('rejects execution failures that are not provider errors', () => {
    const error = new ClaudeCodeResultError('No conversation found with session ID: stale', 'error_during_execution', [
      'No conversation found with session ID: stale'
    ])
    expect(classifyFallbackEligibleError(error)).toBeUndefined()
  })

  it('rejects errors the SDK did not shape as a result error', () => {
    expect(classifyFallbackEligibleError(new Error('aborted'))).toBeUndefined()
    expect(classifyFallbackEligibleError(undefined)).toBeUndefined()
  })
})

describe('selectFallbackModelId', () => {
  it('is gated on the retry feature', () => {
    expect(selectFallbackModelId(policy({ enabled: false }), CURRENT_MODEL)).toBeUndefined()
  })

  it('skips malformed ids and ids equal to the failed model, then picks the first valid one', () => {
    expect(
      selectFallbackModelId(
        policy({
          fallbackModelIds: [
            'not-a-model-id',
            CURRENT_MODEL,
            'other-provider::haiku',
            'other-provider::glm'
          ] as RetryPolicy['fallbackModelIds']
        }),
        CURRENT_MODEL
      )
    ).toBe('other-provider::haiku')
  })

  it('returns undefined when every configured fallback equals the failed model', () => {
    expect(selectFallbackModelId(policy({ fallbackModelIds: [CURRENT_MODEL] }), CURRENT_MODEL)).toBeUndefined()
  })
})

describe('resolveAgentSessionFallback', () => {
  it('restarts on the first valid fallback when a retryable error hit a turn with no activity', () => {
    const error = new ClaudeCodeResultError(
      'API Error: 529 overloaded',
      'error_during_execution',
      ['API Error: 529 overloaded'],
      'api_error'
    )
    expect(
      resolveAgentSessionFallback({ error, currentModelId: CURRENT_MODEL, hasTurnActivity: false, policy: policy() })
    ).toEqual({ fallbackModelId: 'other-provider::haiku', reason: 'http 529' })
  })

  it('keeps the model when the turn already produced content', () => {
    const error = new ClaudeCodeResultError('API Error', 'success', ['API Error'], 'api_error', 429)
    expect(
      resolveAgentSessionFallback({ error, currentModelId: CURRENT_MODEL, hasTurnActivity: true, policy: policy() })
    ).toBeUndefined()
  })

  it('keeps the model when the failure is not fallback-worthy or nothing is configured', () => {
    const exhausted = new ClaudeCodeResultError('Reached the maximum number of turns.', 'error_max_turns', [
      'Reached the maximum number of turns.'
    ])
    expect(
      resolveAgentSessionFallback({
        error: exhausted,
        currentModelId: CURRENT_MODEL,
        hasTurnActivity: false,
        policy: policy()
      })
    ).toBeUndefined()

    const rateLimited = new ClaudeCodeResultError('API Error', 'success', ['API Error'], 'api_error', 429)
    expect(
      resolveAgentSessionFallback({
        error: rateLimited,
        currentModelId: CURRENT_MODEL,
        hasTurnActivity: false,
        policy: policy({ fallbackModelIds: [] })
      })
    ).toBeUndefined()
  })
})
