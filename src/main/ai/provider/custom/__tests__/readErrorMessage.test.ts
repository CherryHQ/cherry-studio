import { describe, expect, it } from 'vitest'

import { readErrorMessage } from '../readErrorMessage'

describe('readErrorMessage', () => {
  it.each([
    { body: { error: { message: { detail: 'not text' } }, message: 'outer error' }, expected: 'outer error' },
    { body: { error: { message: 42 }, message: 'outer error' }, expected: 'outer error' },
    { body: { error: { message: ' nested error ' }, message: 'outer error' }, expected: ' nested error ' },
    { body: { error: { message: '' }, message: 'outer error' }, expected: 'outer error' },
    { body: { message: { detail: 'not text' } }, expected: 'HTTP 503' },
    { body: null, expected: 'HTTP 503' }
  ])('selects actual message text or the HTTP fallback: $body', async ({ body, expected }) => {
    expect(await readErrorMessage(new Response(JSON.stringify(body), { status: 503 }))).toBe(expected)
  })

  it('retains bounded plain-text diagnostics when the response is not JSON', async () => {
    const text = 'server unavailable '.repeat(30)
    expect(await readErrorMessage(new Response(text, { status: 503 }))).toBe(text.slice(0, 300))
  })

  it('uses the supplied fallback when reading the response body fails', async () => {
    const body = new ReadableStream({ start: (controller) => controller.error(new Error('connection lost')) })
    expect(await readErrorMessage(new Response(body, { status: 503 }), 'localized failure')).toBe('localized failure')
  })
})
