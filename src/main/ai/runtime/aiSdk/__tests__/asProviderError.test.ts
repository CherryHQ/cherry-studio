import { describe, expect, it } from 'vitest'

import { asProviderError } from '../Agent'

describe('asProviderError', () => {
  it('keeps a plain provider message readable', () => {
    const error = asProviderError({ message: 'Stream must be set to true' })
    expect(error.message).toContain('Stream must be set to true')
  })

  it('drops a structured request echo instead of copying it into the wrapped error', () => {
    const marker = 'PRIVATE-PROMPT-MARKER'
    const echo = JSON.stringify({ error: { message: 'bad request' }, request: { input: [{ content: marker }] } })
    const error = asProviderError({ message: echo })
    expect(error.message).not.toContain(marker)
    expect(error.stack ?? '').not.toContain(marker)
  })

  it('drops an encoded structured echo nested inside a string payload', () => {
    const marker = 'PRIVATE-PROMPT-MARKER'
    const encoded = JSON.stringify(JSON.stringify({ messages: [{ role: 'user', content: marker }] }))
    expect(asProviderError(encoded).message).not.toContain(marker)
  })
})
