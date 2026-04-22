import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useKnowledgeV2RagConfig } from '../useKnowledgeV2RagConfig'

const mockUseModels = vi.fn()

vi.mock('@renderer/hooks/useModels', () => ({
  useModels: (...args: unknown[]) => mockUseModels(...args)
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
  })

  it('builds processor options from shared file-processing presets and model options from live model data', () => {
    const { result } = renderHook(() =>
      useKnowledgeV2RagConfig(
        createKnowledgeBase({
          fileProcessorId: 'doc2x',
          rerankModelId: 'jina::jina-reranker-v2-base-multilingual'
        })
      )
    )

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
    expect(result.current.fileProcessorOptions.map((option) => option.value)).not.toContain('tesseract')
    expect(result.current.fileProcessorOptions.map((option) => option.value)).not.toContain('system')
    expect(result.current.fileProcessorOptions.map((option) => option.value)).not.toContain('ovocr')
    expect(mockUseModels).toHaveBeenCalledWith({ capability: MODEL_CAPABILITY.EMBEDDING, enabled: true })
    expect(mockUseModels).toHaveBeenCalledWith({ capability: MODEL_CAPABILITY.RERANK, enabled: true })
  })
})
