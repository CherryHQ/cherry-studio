import { describe, expect, it } from 'vitest'

import { resolveKnowledgeBaseScope } from '../knowledgeScope'

describe('resolveKnowledgeBaseScope', () => {
  it('prefers configured ids when present', () => {
    expect(resolveKnowledgeBaseScope(['kb-configured'], ['kb-selected'])).toEqual(['kb-configured'])
  })

  it('falls back to selected ids and deduplicates them', () => {
    expect(resolveKnowledgeBaseScope([], ['kb-1', 'kb-2', 'kb-1'])).toEqual(['kb-1', 'kb-2'])
  })

  it('returns an empty scope when neither source has ids', () => {
    expect(resolveKnowledgeBaseScope(undefined, undefined)).toEqual([])
  })
})
