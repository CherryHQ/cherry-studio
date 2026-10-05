import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DataApiErrorFactory } from '@shared/data/api/errors'

import type { RetryPolicy } from '../../aiSdk'
import { classifyFallbackEligibleError, resolveAgentSessionFallback, selectFallbackModelId } from '../modelFallback'
import { ClaudeCodeResultError } from '../streamAdapter'

const getByProviderId = vi.hoisted(() => vi.fn())
const getByKey = vi.hoisted(() => vi.fn())
vi.mock('@data/services/ProviderService', () => ({
  providerService: { getByProviderId: (...a: unknown[]) => getByProviderId(...a) }
}))
vi.mock('@data/services/ModelService', () => ({
  modelService: { getByKey: (...a: unknown[]) => getByKey(...a) }
}))

const CURRENT_MODEL = 'claude-code::sonnet'

beforeEach(() => {
  getByProviderId.mockReset().mockReturnValue({ id: 'other-provider', isEnabled: true })
  getByKey.mockReset().mockReturnValue({ id: 'haiku' })
})

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

  // A turn gets ONE fallback attempt, so a stale id in front of a healthy one used to cost the turn
  // its fallback entirely: the driver latched `fallbackAttempted` before proving the candidate was
  // reachable, then the NOT_FOUND surfaced as the turn's error and the healthy entry was never tried.
  it('skips a fallback whose provider was deleted and takes the next configured one', () => {
    getByProviderId.mockImplementation((providerId: string) => {
      if (providerId === 'deleted-provider') throw DataApiErrorFactory.notFound('Provider', 'gone')
      return { id: providerId, isEnabled: true }
    })

    expect(
      selectFallbackModelId(
        policy({ fallbackModelIds: ['deleted-provider::haiku', 'healthy-provider::glm'] }),
        CURRENT_MODEL
      )
    ).toBe('healthy-provider::glm')
  })

  it('skips a fallback whose model was deleted', () => {
    getByKey.mockImplementation((providerId: string, modelId: string) => {
      if (modelId === 'removed') throw DataApiErrorFactory.notFound('Model', 'gone')
      return { id: modelId, providerId }
    })

    expect(
      selectFallbackModelId(
        policy({ fallbackModelIds: ['healthy-provider::removed', 'healthy-provider::glm'] }),
        CURRENT_MODEL
      )
    ).toBe('healthy-provider::glm')
  })

  // The gateway refuses a disabled provider's models, so routing to one only buys an opaque 404
  // (issue #20547) — the chat retry path already skips these for the same reason.
  it('skips a fallback whose provider is disabled', () => {
    getByProviderId.mockImplementation((providerId: string) => ({
      id: providerId,
      isEnabled: providerId !== 'disabled-provider'
    }))

    expect(
      selectFallbackModelId(
        policy({ fallbackModelIds: ['disabled-provider::haiku', 'healthy-provider::glm'] }),
        CURRENT_MODEL
      )
    ).toBe('healthy-provider::glm')
  })

  it('returns undefined when every remaining fallback is unreachable', () => {
    getByProviderId.mockImplementation(() => {
      throw DataApiErrorFactory.notFound('Provider', 'gone')
    })

    expect(
      selectFallbackModelId(policy({ fallbackModelIds: ['gone-a::haiku', 'gone-b::glm'] }), CURRENT_MODEL)
    ).toBeUndefined()
  })

  it('propagates a non-NOT_FOUND resolution failure instead of silently skipping it', () => {
    getByProviderId.mockImplementation(() => {
      throw new Error('database is locked')
    })

    expect(() => selectFallbackModelId(policy(), CURRENT_MODEL)).toThrow('database is locked')
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
