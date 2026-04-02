import type { KnowledgeBaseParams } from '@types'
import { describe, expect, it } from 'vitest'

import { getKnowledgeBaseEmbedCacheSignature } from '../knowledgeBaseEmbedSignature'

function makeBase(overrides: Partial<KnowledgeBaseParams> = {}): KnowledgeBaseParams {
  return {
    id: 'kb-1',
    dimensions: 1024,
    documentCount: 10,
    embedApiClient: {
      model: 'bge-m3',
      provider: 'silicon',
      apiKey: 'key-a',
      baseURL: 'https://api.example.com/v1'
    },
    ...overrides
  }
}

describe('getKnowledgeBaseEmbedCacheSignature', () => {
  it('returns the same string for identical configs', () => {
    const a = makeBase()
    const b = makeBase()
    expect(getKnowledgeBaseEmbedCacheSignature(a)).toBe(getKnowledgeBaseEmbedCacheSignature(b))
  })

  it('changes when apiKey changes', () => {
    const a = makeBase()
    const b = makeBase({
      embedApiClient: {
        ...a.embedApiClient,
        apiKey: 'key-b'
      }
    })
    expect(getKnowledgeBaseEmbedCacheSignature(a)).not.toBe(getKnowledgeBaseEmbedCacheSignature(b))
  })

  it('changes when baseURL changes', () => {
    const a = makeBase()
    const b = makeBase({
      embedApiClient: {
        ...a.embedApiClient,
        baseURL: 'https://other.example.com/v1'
      }
    })
    expect(getKnowledgeBaseEmbedCacheSignature(a)).not.toBe(getKnowledgeBaseEmbedCacheSignature(b))
  })

  it('changes when embedding model id changes', () => {
    const a = makeBase()
    const b = makeBase({
      embedApiClient: {
        ...a.embedApiClient,
        model: 'other-model'
      }
    })
    expect(getKnowledgeBaseEmbedCacheSignature(a)).not.toBe(getKnowledgeBaseEmbedCacheSignature(b))
  })

  it('changes when dimensions or documentCount change', () => {
    const base = makeBase()
    expect(getKnowledgeBaseEmbedCacheSignature(base)).not.toBe(
      getKnowledgeBaseEmbedCacheSignature({ ...base, dimensions: 512 })
    )
    expect(getKnowledgeBaseEmbedCacheSignature(base)).not.toBe(
      getKnowledgeBaseEmbedCacheSignature({ ...base, documentCount: 20 })
    )
  })
})
