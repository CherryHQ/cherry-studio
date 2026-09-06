import { describe, expect, it } from 'vitest'

import { getSafeProviderErrorMessage } from '../providerError'

const PROVIDER_TEXT_FIELDS = [
  ['message', (value: string) => ({ message: value })],
  ['msg', (value: string) => ({ msg: value })],
  ['error.message', (value: string) => ({ error: { message: value } })],
  ['detail.message', (value: string) => ({ detail: { message: value } })],
  ['detail.error.message', (value: string) => ({ detail: { error: { message: value } } })],
  ['detail', (value: string) => ({ detail: value })],
  ['error', (value: string) => ({ error: value })]
] as const

describe('getSafeProviderErrorMessage', () => {
  it.each(PROVIDER_TEXT_FIELDS)('ignores direct and repeatedly encoded JSON containers in %s', (_field, payloadFor) => {
    const privatePayloads = [
      JSON.stringify({ prompt: 'private user prompt', trace: 'internal trace' }),
      JSON.stringify([{ prompt: 'private user prompt' }])
    ].flatMap((value) => [value, JSON.stringify(value)])

    for (const privatePayload of privatePayloads) {
      const message = getSafeProviderErrorMessage({
        message: 'Bad Request',
        responseBody: JSON.stringify(payloadFor(privatePayload))
      })

      expect(message).toBe('Bad Request')
      expect(message).not.toMatch(/private user prompt|internal trace/)
    }
  })

  it.each(PROVIDER_TEXT_FIELDS)(
    'ignores direct and repeatedly encoded malformed objects in %s',
    (_field, payloadFor) => {
      const malformed = '{"prompt":"private user prompt","trace":"internal trace"'

      for (const privatePayload of [malformed, JSON.stringify(malformed)]) {
        const message = getSafeProviderErrorMessage({
          message: 'Bad Request',
          responseBody: JSON.stringify(payloadFor(privatePayload))
        })

        expect(message).toBe('Bad Request')
        expect(message).not.toMatch(/private user prompt|internal trace/)
      }
    }
  )

  it.each(PROVIDER_TEXT_FIELDS)(
    'ignores direct and repeatedly encoded malformed quote-prefixed containers in %s',
    (_field, payloadFor) => {
      const malformed = `"${JSON.stringify({ prompt: 'private user prompt', trace: 'internal trace' })}`

      for (const privatePayload of [malformed, JSON.stringify(malformed)]) {
        const message = getSafeProviderErrorMessage({
          message: 'Bad Request',
          responseBody: JSON.stringify(payloadFor(privatePayload))
        })

        expect(message).toBe('Bad Request')
        expect(message).not.toMatch(/private user prompt|internal trace/)
      }
    }
  )

  it.each(PROVIDER_TEXT_FIELDS)(
    'ignores malformed single-quoted and escaped-quote containers in %s',
    (_field, payloadFor) => {
      const privateObject = JSON.stringify({ prompt: 'private user prompt', trace: 'internal trace' })

      for (const privatePayload of [`'${privateObject}`, `\\"${privateObject}`]) {
        const message = getSafeProviderErrorMessage({
          message: 'Bad Request',
          responseBody: JSON.stringify(payloadFor(privatePayload))
        })

        expect(message).toBe('Bad Request')
        expect(message).not.toMatch(/private user prompt|internal trace/)
      }
    }
  )

  it('ignores an oversized provider payload before decoding it', () => {
    const message = getSafeProviderErrorMessage({
      message: 'Bad Request',
      responseBody: JSON.stringify({ detail: 'x'.repeat(1_000_000) })
    })

    expect(message).toBe('Bad Request')
  })

  it('ignores provider text nested beyond the supported decode depth', () => {
    let deeplyEncoded = 'Service temporarily unavailable'
    for (let depth = 0; depth < 8; depth += 1) deeplyEncoded = JSON.stringify(deeplyEncoded)

    expect(
      getSafeProviderErrorMessage({
        message: 'Bad Request',
        responseBody: JSON.stringify({ detail: deeplyEncoded })
      })
    ).toBe('Bad Request')
  })

  it.each(PROVIDER_TEXT_FIELDS)('keeps normal provider text in %s', (_field, payloadFor) => {
    expect(
      getSafeProviderErrorMessage({ responseBody: JSON.stringify(payloadFor('Service temporarily unavailable')) })
    ).toBe('Service temporarily unavailable')
  })

  it.each(PROVIDER_TEXT_FIELDS)('keeps JSON primitive payload text in %s', (_field, payloadFor) => {
    for (const value of ['"quoted provider message"', '400', 'true']) {
      expect(getSafeProviderErrorMessage({ responseBody: JSON.stringify(payloadFor(value)) })).toBe(value)
    }
  })
})
