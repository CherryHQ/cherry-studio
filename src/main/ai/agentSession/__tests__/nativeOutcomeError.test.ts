import { describe, expect, it } from 'vitest'

import { nativeOutcomeError } from '../nativeSubmission'

describe('nativeOutcomeError', () => {
  it('marks an output-truncated outcome app-owned so its count-bearing text is never AI-diagnosed', () => {
    const error = nativeOutcomeError({
      outcome: 'failed',
      error: { operation: 'input', code: 'output-truncated', message: 'Response truncated: cap 8192, output 8192' }
    })
    expect(error).toMatchObject({
      message: 'Response truncated: cap 8192, output 8192',
      reason: 'output-truncated',
      finishReason: 'length',
      i18nKey: 'output_token_limit_reached',
      detailI18nKey: 'output_token_limit_detail',
      detailI18nValues: { detail: 'Response truncated: cap 8192, output 8192' }
    })
  })

  it('leaves other failures without an app-owned key', () => {
    const error = nativeOutcomeError({
      outcome: 'failed',
      error: { operation: 'input', code: 'model-error', message: 'boom' }
    })
    expect(error).toMatchObject({ message: 'boom', reason: 'model-error' })
    expect(error).not.toHaveProperty('i18nKey')
  })
})
