import { describe, expect, it } from 'vitest'

import { buildImageUrl, GenerateImagePayloadSchema } from '../pollinations'

describe('buildImageUrl', () => {
  it('encodes the prompt into the path', () => {
    expect(buildImageUrl({ prompt: 'a red apple' })).toContain('/prompt/a%20red%20apple')
  })

  it('encodes characters that would otherwise start a query string', () => {
    const url = buildImageUrl({ prompt: 'what if? #1' })
    expect(url).toContain('what%20if%3F%20%231')
    // The only query the service should see is the one we put there.
    expect(new URL(url).searchParams.get('nologo')).toBe('true')
  })

  it('passes the optional knobs through and drops the ones not given', () => {
    const url = new URL(buildImageUrl({ prompt: 'cat', width: 512, height: 256, seed: 7, model: 'flux' }))
    expect(url.searchParams.get('width')).toBe('512')
    expect(url.searchParams.get('height')).toBe('256')
    expect(url.searchParams.get('seed')).toBe('7')
    expect(url.searchParams.get('model')).toBe('flux')
    expect(buildImageUrl({ prompt: 'cat' })).not.toContain('width=')
  })

  it('keeps seed 0, which a truthiness check would throw away', () => {
    expect(new URL(buildImageUrl({ prompt: 'cat', seed: 0 })).searchParams.get('seed')).toBe('0')
  })

  it('trims a prompt so trailing whitespace does not become %20 padding', () => {
    expect(buildImageUrl({ prompt: '  cat  ' })).toContain('/prompt/cat?')
  })
})

describe('GenerateImagePayloadSchema', () => {
  it('rejects an empty prompt rather than generating noise', () => {
    expect(GenerateImagePayloadSchema.safeParse({ prompt: '' }).success).toBe(false)
  })

  it('rejects a size the service will not serve', () => {
    expect(GenerateImagePayloadSchema.safeParse({ prompt: 'cat', width: 99999 }).success).toBe(false)
    expect(GenerateImagePayloadSchema.safeParse({ prompt: 'cat', width: 8 }).success).toBe(false)
  })
})
