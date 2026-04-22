import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useKnowledgeV2RagConfig } from '../useKnowledgeV2RagConfig'

const mockUseProviders = vi.fn()
const mockUsePreprocessProviders = vi.fn()

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => mockUseProviders()
}))

vi.mock('@renderer/hooks/usePreprocess', () => ({
  usePreprocessProviders: () => mockUsePreprocessProviders()
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBase>): KnowledgeBase => ({
  id: '',
  name: '',
  description: undefined,
  groupId: null,
  emoji: '📁',
  dimensions: 1536,
  embeddingModelId: 'openai::text-embedding-3-small',
  rerankModelId: undefined,
  fileProcessorId: undefined,
  chunkSize: undefined,
  chunkOverlap: undefined,
  threshold: undefined,
  documentCount: undefined,
  searchMode: undefined,
  hybridAlpha: undefined,
  createdAt: '2026-04-15T09:00:00+08:00',
  updatedAt: '2026-04-15T09:00:00+08:00',
  ...overrides
})

describe('useKnowledgeV2RagConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseProviders.mockReturnValue({
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          isSystem: false,
          models: [
            {
              id: 'text-embedding-3-small',
              name: 'text-embedding-3-small',
              provider: 'openai',
              group: 'embedding'
            },
            {
              id: 'gpt-4o-mini',
              name: 'gpt-4o-mini',
              provider: 'openai',
              group: 'chat'
            }
          ]
        },
        {
          id: 'jina',
          name: 'Jina AI',
          isSystem: false,
          models: [
            {
              id: 'jina-reranker-v2-base-multilingual',
              name: 'jina-reranker-v2-base-multilingual',
              provider: 'jina',
              group: 'rerank'
            }
          ]
        }
      ]
    })
    mockUsePreprocessProviders.mockReturnValue({
      preprocessProviders: [
        { id: 'doc2x', name: 'Doc2X' },
        { id: 'mineru', name: 'MinerU' }
      ]
    })
  })

  it('builds processor, embedding, and rerank options from live provider data', () => {
    const { result } = renderHook(() =>
      useKnowledgeV2RagConfig(
        createKnowledgeBase({
          fileProcessorId: 'doc2x',
          rerankModelId: 'jina::jina-reranker-v2-base-multilingual'
        })
      )
    )

    expect(result.current.fileProcessorOptions).toEqual([
      { value: 'doc2x', label: 'Doc2X' },
      { value: 'mineru', label: 'MinerU' }
    ])
    expect(result.current.embeddingModelOptions).toEqual([
      {
        value: 'openai::text-embedding-3-small',
        label: 'text-embedding-3-small · OpenAI'
      }
    ])
    expect(result.current.rerankModelOptions).toEqual([
      {
        value: 'jina::jina-reranker-v2-base-multilingual',
        label: 'jina-reranker-v2-base-multilingual · Jina AI'
      }
    ])
  })

  it('keeps the current saved values selectable even when the source lists no longer contain them', () => {
    const { result } = renderHook(() =>
      useKnowledgeV2RagConfig(
        createKnowledgeBase({
          fileProcessorId: 'legacy-processor',
          embeddingModelId: 'legacy::embedding-model',
          rerankModelId: 'legacy::rerank-model'
        })
      )
    )

    expect(result.current.fileProcessorOptions.at(-1)).toEqual({
      value: 'legacy-processor',
      label: 'legacy-processor'
    })
    expect(result.current.embeddingModelOptions.at(-1)).toEqual({
      value: 'legacy::embedding-model',
      label: 'legacy::embedding-model'
    })
    expect(result.current.rerankModelOptions.at(-1)).toEqual({
      value: 'legacy::rerank-model',
      label: 'legacy::rerank-model'
    })
  })
})
