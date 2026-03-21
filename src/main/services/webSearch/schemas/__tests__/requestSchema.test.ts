import { describe, expect, it } from 'vitest'

import { WebSearchRequestSchema } from '../requestSchema'

describe('WebSearchRequestSchema', () => {
  it('accepts a valid request shape', () => {
    const parsed = WebSearchRequestSchema.parse({
      providerId: 'tavily',
      input: {
        question: ['hello']
      },
      requestId: 'request-1'
    })

    expect(parsed.providerId).toBe('tavily')
    expect(parsed.input.question).toEqual(['hello'])
  })

  it('rejects invalid provider ids', () => {
    const result = WebSearchRequestSchema.safeParse({
      providerId: 'unknown-provider',
      input: {
        question: ['hello']
      },
      requestId: 'request-1'
    })

    expect(result.success).toBe(false)
  })

  it('rejects empty request ids', () => {
    const result = WebSearchRequestSchema.safeParse({
      providerId: 'tavily',
      input: {
        question: []
      },
      requestId: ''
    })

    expect(result.success).toBe(false)
  })

  it('rejects blank questions', () => {
    const result = WebSearchRequestSchema.safeParse({
      providerId: 'tavily',
      input: {
        question: ['hello', '   ']
      },
      requestId: 'request-1'
    })

    expect(result.success).toBe(false)
  })
})
