import { describe, expect, it } from 'vitest'

import type { SerializedError } from '@renderer/types/error'

import { healthCheckErrorToDiagnosis } from '../healthCheck'

/** Echoes the key so the test asserts which diagnosis was chosen, not its wording. */
const t = (key: string) => key

function providerError(overrides: Partial<Record<string, unknown>>): SerializedError {
  return { name: 'AI_APICallError', message: '', ...overrides } as unknown as SerializedError
}

describe('healthCheckErrorToDiagnosis', () => {
  it('reads a spent account as a quota problem, not a broken key', () => {
    // The exact failure this fork hit: a valid DeepSeek key with no credit. Calling it an auth
    // error sends the user off regenerating a key that was never the problem.
    const error = providerError({ message: 'Insufficient Balance', statusCode: 402 })

    expect(healthCheckErrorToDiagnosis(error, t)).toBe('error.diagnosis.quota')
  })

  it('separates a rejected key from a spent one', () => {
    expect(healthCheckErrorToDiagnosis(providerError({ message: 'Incorrect API key', statusCode: 401 }), t)).toBe(
      'error.diagnosis.auth'
    )
  })

  it('names a rate limit rather than leaving the user to guess at 429', () => {
    expect(healthCheckErrorToDiagnosis(providerError({ message: 'Too Many Requests', statusCode: 429 }), t)).toBe(
      'error.diagnosis.rate_limit'
    )
  })

  it('says nothing when it cannot tell, so the provider text stands alone', () => {
    // An invented explanation is worse than none: it would send the user to the wrong screen.
    expect(healthCheckErrorToDiagnosis(providerError({ message: 'something went sideways' }), t)).toBeUndefined()
  })

  it('has nothing to add to a bare string or a missing error', () => {
    expect(healthCheckErrorToDiagnosis('Insufficient Balance', t)).toBeUndefined()
    expect(healthCheckErrorToDiagnosis(undefined, t)).toBeUndefined()
  })
})
