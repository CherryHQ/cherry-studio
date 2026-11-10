import { describe, expect, it } from 'vitest'

import { parseKnowledgeRouteSearch } from '../routeSearch'

describe('parseKnowledgeRouteSearch', () => {
  it('keeps a non-empty knowledge base id', () => {
    expect(parseKnowledgeRouteSearch({ baseId: 'base-1' })).toEqual({ baseId: 'base-1' })
  })

  it('drops empty and non-string values', () => {
    expect(parseKnowledgeRouteSearch({ baseId: '' })).toEqual({ baseId: undefined })
    expect(parseKnowledgeRouteSearch({ baseId: 1 })).toEqual({ baseId: undefined })
  })
})
