import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useKnowledgeConfig } from '../useKnowledgeConfig'

const mockUseModels = vi.fn()
const mockUseMutation = vi.fn()
const mockTrigger = vi.fn()

vi.mock('@renderer/hooks/useModels', () => ({
  useModels: (...args: unknown[]) => mockUseModels(...args)
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: (...args: unknown[]) => mockUseMutation(...args)
}))

vi.mock('@renderer/i18n/label', () => ({
  getFileProcessorLabel: (id: string) =>
    (
      ({
        paddleocr: 'PaddleOCR',
        mineru: 'MinerU',
        doc2x: 'Doc2X',
        mistral: 'Mistral',
        'open-mineru': 'Open MinerU'
      }) as Record<string, string>
    )[id] ?? id
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'knowledge_v2.rag.search_mode.hybrid': '混合检索（推荐）',
          'knowledge_v2.rag.search_mode.default': '向量检索',
          'knowledge_v2.rag.search_mode.bm25': '全文检索'
        }) as Record<string, string>
      )[key] ?? key
  })
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
  chunkSize: 1024,
  chunkOverlap: 200,
  threshold: 0,
  documentCount: 6,
  searchMode: 'hybrid',
  hybridAlpha: 0.6,
  createdAt: '2026-04-15T09:00:00+08:00',
  updatedAt: '2026-04-15T09:00:00+08:00',
  ...overrides
})

describe('useKnowledgeConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseModels.mockImplementation((query?: { capability?: string; enabled?: boolean }) => {
      if (query?.capability === MODEL_CAPABILITY.EMBEDDING) {
        return {
          models: [
            {
              id: 'openai::text-embedding-3-small',
              providerId: 'openai',
              name: 'text-embedding-3-small',
              capabilities: [MODEL_CAPABILITY.EMBEDDING],
              supportsStreaming: false,
              isEnabled: true,
              isHidden: false
            }
          ]
        }
      }

      if (query?.capability === MODEL_CAPABILITY.RERANK) {
        return {
          models: [
            {
              id: 'jina::jina-reranker-v2-base-multilingual',
              providerId: 'jina',
              name: 'jina-reranker-v2-base-multilingual',
              capabilities: [MODEL_CAPABILITY.RERANK],
              supportsStreaming: false,
              isEnabled: true,
              isHidden: false
            }
          ]
        }
      }

      return { models: [] }
    })
    mockUseMutation.mockReturnValue({
      trigger: mockTrigger,
      isLoading: false,
      error: undefined
    })
  })

  it('builds options from shared data and translations and exposes the save mutation', async () => {
    const base = createKnowledgeBase({
      fileProcessorId: 'doc2x',
      rerankModelId: 'jina::jina-reranker-v2-base-multilingual'
    })
    const { result } = renderHook(() => useKnowledgeConfig(base))

    expect(result.current.fileProcessorOptions).toEqual([
      { value: 'paddleocr', label: 'PaddleOCR' },
      { value: 'mineru', label: 'MinerU' },
      { value: 'doc2x', label: 'Doc2X' },
      { value: 'mistral', label: 'Mistral' },
      { value: 'open-mineru', label: 'Open MinerU' }
    ])
    expect(result.current.embeddingModelOptions).toEqual([
      {
        value: 'openai::text-embedding-3-small',
        label: 'text-embedding-3-small · openai'
      }
    ])
    expect(result.current.rerankModelOptions).toEqual([
      {
        value: 'jina::jina-reranker-v2-base-multilingual',
        label: 'jina-reranker-v2-base-multilingual · jina'
      }
    ])
    expect(result.current.searchModeOptions).toEqual([
      { value: 'hybrid', label: '混合检索（推荐）' },
      { value: 'default', label: '向量检索' },
      { value: 'bm25', label: '全文检索' }
    ])
    expect(result.current.fileProcessorOptions.map((option) => option.value)).not.toContain('tesseract')
    expect(result.current.fileProcessorOptions.map((option) => option.value)).not.toContain('system')
    expect(result.current.fileProcessorOptions.map((option) => option.value)).not.toContain('ovocr')
    expect(mockUseModels).toHaveBeenCalledWith({ capability: MODEL_CAPABILITY.EMBEDDING, enabled: true })
    expect(mockUseModels).toHaveBeenCalledWith({ capability: MODEL_CAPABILITY.RERANK, enabled: true })
    expect(mockUseMutation).toHaveBeenCalledWith('PATCH', '/knowledge-bases/:id', {
      refresh: ['/knowledge-bases']
    })

    await act(async () => {
      await result.current.save({
        fileProcessorId: null,
        chunkSize: '1536',
        chunkOverlap: '256',
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
        chunkSize: 1536,
        chunkOverlap: 256,
        embeddingModelId: 'voyage::voyage-3-large',
        documentCount: 10,
        threshold: 0.25,
        searchMode: 'default',
        hybridAlpha: null
      }
    })
  })
})
