import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useKnowledgeV2SaveRagConfig } from '../useKnowledgeV2SaveRagConfig'

const mockUseMutation = vi.fn()
const mockTrigger = vi.fn()

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: (...args: unknown[]) => mockUseMutation(...args)
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  id: 'base-1',
  name: 'Base 1',
  description: undefined,
  groupId: null,
  emoji: '📁',
  dimensions: 1536,
  embeddingModelId: 'openai::text-embedding-3-small',
  rerankModelId: undefined,
  fileProcessorId: undefined,
  chunkSize: 512,
  chunkOverlap: 64,
  threshold: 0,
  documentCount: 6,
  searchMode: 'hybrid',
  hybridAlpha: 0.6,
  createdAt: '2026-04-15T09:00:00+08:00',
  updatedAt: '2026-04-15T09:00:00+08:00',
  ...overrides
})

describe('useKnowledgeV2SaveRagConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMutation.mockReturnValue({
      trigger: mockTrigger,
      isLoading: false,
      error: undefined
    })
  })

  it('uses the template patch endpoint and normalizes the outgoing payload', async () => {
    const base = createKnowledgeBase()
    const { result } = renderHook(() => useKnowledgeV2SaveRagConfig(base))

    expect(mockUseMutation).toHaveBeenCalledWith('PATCH', '/knowledge-bases/:id', {
      refresh: ['/knowledge-bases']
    })

    await act(async () => {
      await result.current.save({
        fileProcessorId: null,
        chunkSize: '',
        chunkOverlap: '',
        embeddingModelId: 'voyage::voyage-3-large',
        rerankModelId: null,
        dimensions: 1536,
        documentCount: 10,
        threshold: 0.25,
        searchMode: 'default',
        hybridAlpha: 0.6
      })
    })

    expect(mockTrigger).toHaveBeenCalledWith({
      params: { id: 'base-1' },
      body: {
        chunkSize: null,
        chunkOverlap: null,
        embeddingModelId: 'voyage::voyage-3-large',
        documentCount: 10,
        threshold: 0.25,
        searchMode: 'default',
        hybridAlpha: null
      }
    })
  })
})
