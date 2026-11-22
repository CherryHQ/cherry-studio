import { describe, expect, it } from 'vitest'

import { normalizeVertexCredentials } from '../vertex'

describe('normalizeVertexCredentials', () => {
  it('normalizes a frozen snake-case key file without changing its values', () => {
    const credentials = Object.freeze({ private_key: 'private-key', client_email: 'service@example.com' })

    expect(normalizeVertexCredentials(credentials)).toEqual({
      privateKey: 'private-key',
      clientEmail: 'service@example.com'
    })
    expect(credentials).toEqual({ private_key: 'private-key', client_email: 'service@example.com' })
  })

  it('keeps camel-case values ahead of snake-case aliases', () => {
    expect(
      normalizeVertexCredentials({
        privateKey: 'preferred-key',
        private_key: 'other-key',
        clientEmail: 'preferred@example.com',
        client_email: 'other@example.com'
      })
    ).toEqual({ privateKey: 'preferred-key', clientEmail: 'preferred@example.com' })
  })

  it('keeps absent credentials absent', () => {
    expect(normalizeVertexCredentials(undefined)).toEqual({})
  })

  it.each([
    { private_key: 42 },
    { privateKey: 42, private_key: 'valid-alias' },
    { client_email: false },
    { clientEmail: ['service@example.com'] }
  ])('rejects credential fields that are not strings: %j', (credentials) => {
    expect(() => normalizeVertexCredentials(credentials)).toThrow()
  })
})
