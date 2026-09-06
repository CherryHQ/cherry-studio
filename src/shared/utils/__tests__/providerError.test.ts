import { describe, expect, it } from 'vitest'

import { getSafeProviderErrorMessage } from '../providerError'

describe('getSafeProviderErrorMessage', () => {
  it.each([
    ['detail', JSON.stringify({ prompt: 'private user prompt', trace: 'internal trace' })],
    ['detail', JSON.stringify([{ prompt: 'private user prompt' }])],
    ['error', JSON.stringify({ prompt: 'private user prompt', trace: 'internal trace' })],
    ['error', JSON.stringify([{ prompt: 'private user prompt' }])]
  ])('ignores serialized JSON objects and arrays in a string-valued %s payload field', (field, privatePayload) => {
    const message = getSafeProviderErrorMessage({
      message: 'Bad Request',
      responseBody: JSON.stringify({ [field]: privatePayload })
    })

    expect(message).toBe('Bad Request')
    expect(message).not.toMatch(/private user prompt|internal trace/)
  })

  it.each(['"quoted provider message"', '400', 'true'])('keeps a JSON primitive payload message: %s', (detail) => {
    expect(getSafeProviderErrorMessage({ responseBody: JSON.stringify({ detail }) })).toBe(detail)
  })
})
