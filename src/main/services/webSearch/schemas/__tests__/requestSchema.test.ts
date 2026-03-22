import { describe, expect, it } from 'vitest'

import { WebSearchRequestSchema } from '../requestSchema'

describe('WebSearchRequestSchema', () => {
  it('accepts a valid request shape', () => {
    const parsed = WebSearchRequestSchema.parse({
      providerId: 'tavily',
      questions: ['hello'],
      requestId: 'request-1'
    })

    expect(parsed.providerId).toBe('tavily')
    expect(parsed.questions).toEqual(['hello'])
  })

  it('normalizes questions by trimming surrounding whitespace', () => {
    const parsed = WebSearchRequestSchema.parse({
      providerId: 'tavily',
      questions: ['  hello  ', '\tworld\n'],
      requestId: 'request-1'
    })

    expect(parsed.questions).toEqual(['hello', 'world'])
  })

  it('rejects invalid provider ids', () => {
    const result = WebSearchRequestSchema.safeParse({
      providerId: 'unknown-provider',
      questions: ['hello'],
      requestId: 'request-1'
    })

    expect(result.success).toBe(false)
  })

  it('rejects empty request ids', () => {
    const result = WebSearchRequestSchema.safeParse({
      providerId: 'tavily',
      questions: [],
      requestId: ''
    })

    expect(result.success).toBe(false)
  })

  it('rejects blank questions', () => {
    const result = WebSearchRequestSchema.safeParse({
      providerId: 'tavily',
      questions: ['hello', '   '],
      requestId: 'request-1'
    })

    expect(result.success).toBe(false)
  })
})
