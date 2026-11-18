import { describe, expect, it } from 'vitest'

import { captureWithFetch } from './captureRequest'

describe('captureWithFetch request bodies', () => {
  it('keeps repeated multipart fields and reserved property names as request data', async () => {
    const body = new FormData()
    body.append('image', 'first')
    body.append('image', new Blob(['abc'], { type: 'image/png' }))
    body.append('__proto__', 'literal')
    body.append('__proto__', 'second')
    body.append('toString', 'field value')

    const captured = await captureWithFetch((fetch) => fetch('https://example.com/images', { method: 'POST', body }))
    expect(captured.body).toEqual({
      image: ['first', '<Blob image/png 3b>'],
      ['__proto__']: ['literal', 'second'],
      toString: 'field value'
    })
    expect(Object.getPrototypeOf(captured.body)).toBe(Object.prototype)
  })

  it('parses JSON without dropping own reserved property names', async () => {
    const captured = await captureWithFetch((fetch) =>
      fetch('https://example.com/images', { method: 'POST', body: '{"__proto__":{"prompt":"keep"},"count":2}' })
    )
    expect(captured.body).toEqual({ ['__proto__']: { prompt: 'keep' }, count: 2 })
    expect(Object.getPrototypeOf(captured.body)).toBe(Object.prototype)
  })
})
