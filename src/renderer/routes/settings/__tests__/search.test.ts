import { describe, expect, it, vi } from 'vitest'

// Cut the component import chain — the validateSearch contract is under test
vi.mock('@renderer/pages/settings/settingsSearch/SearchResultsPage', () => ({
  SearchResultsPage: () => null
}))

import { Route } from '../search'

// Options type unions every validator shape; the route under test passes a plain function
const validate = Route.options.validateSearch as (search: Record<string, unknown>) => Record<string, unknown>

describe('settings search route validateSearch', () => {
  it('keeps a q within the byte budget', () => {
    // 682 CJK chars = 2046 UTF-8 bytes, 682 UTF-16 units — inside both limits
    const q = '长'.repeat(682)
    expect(validate({ q })).toEqual({ q })
  })

  it('degrades a byte-oversized CJK q that UTF-16 unit counting would admit', () => {
    // 683 CJK chars = 2049 bytes but only 683 UTF-16 units: a unit-based
    // .max(2048) passes it while the ranking side rejects it
    expect(validate({ q: '长'.repeat(683) })).toEqual({})
  })

  it('keeps a q at exactly the 2048-byte boundary', () => {
    const q = 'a'.repeat(2048)
    expect(validate({ q })).toEqual({ q })
  })

  it('degrades a non-string q', () => {
    expect(validate({ q: 42 })).toEqual({})
  })
})
