import { describe, expect, it } from 'vitest'

import { stripArkUnsupportedIncludes } from '../ark'

const parse = (body: BodyInit | null | undefined) => JSON.parse(body as string)

describe('stripArkUnsupportedIncludes', () => {
  it('drops the include the Responses adapter pairs with the web_search tool', () => {
    const body = JSON.stringify({
      model: 'doubao-seed-2-1-pro-260628',
      include: ['web_search_call.action.sources', 'reasoning.encrypted_content'],
      tools: [{ type: 'web_search' }]
    })
    expect(parse(stripArkUnsupportedIncludes(body)).include).toEqual(['reasoning.encrypted_content'])
  })

  it('omits include entirely when nothing supported is left', () => {
    const body = JSON.stringify({ include: ['web_search_call.action.sources'] })
    expect(parse(stripArkUnsupportedIncludes(body))).not.toHaveProperty('include')
  })

  it('passes through bodies with no offending include', () => {
    const body = JSON.stringify({ include: ['reasoning.encrypted_content'] })
    expect(stripArkUnsupportedIncludes(body)).toBe(body)
    expect(stripArkUnsupportedIncludes(undefined)).toBeUndefined()
  })
})
