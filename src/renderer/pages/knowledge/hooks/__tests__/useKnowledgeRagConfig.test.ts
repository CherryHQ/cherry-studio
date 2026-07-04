import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useKnowledgeRagConfig } from '../useKnowledgeRagConfig'

const mockUseMutation = vi.fn()
const mockTrigger = vi.fn()
const mockUsePreference = vi.fn()
const mockLogger = vi.hoisted(() => ({
  error: vi.fn()
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: (...args: unknown[]) => mockUseMutation(...args)
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (...args: unknown[]) => mockUsePreference(...args)
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mockLogger.error
    })
  }
}))

vi.mock('@renderer/i18n/label', () => ({
  getFileProcessorLabelKey: (id: string) =>
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
    t: (key: string) => key
  })
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  id: 'base-1',
  name: 'Base 1',
  groupId: null,
  dimensions: 1536,
  embeddingModelId: 'openai::text-embedding-3-small',
  rerankModelId: undefined,
  fileProcessorId: undefined,
  chunkSize: 1024,
  chunkOverlap: 200,
  chunkStrategy: 'structured',
  chunkSeparator: '\\n\\n',
  threshold: 0,
  documentCount: 6,
  status: 'completed',
  error: null,
  searchMode: 'hybrid',
  createdAt: '2026-04-15T09:00:00+08:00',
  updatedAt: '2026-04-15T09:00:00+08:00',
  ...overrides
})

describe('useKnowledgeRagConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMutation.mockReturnValue({
      trigger: mockTrigger,
      isLoading: false,
      error: undefined
    })
    mockUsePreference.mockReturnValue([
      {
        paddleocr: {
          apiKeys: ['paddle-key']
        },
        mineru: {
          apiKeys: []
        },
        mistral: {
          apiKeys: ['   ']
        }
      }
    ])
  })

  it('builds options from configured document processors and exposes the save mutation', async () => {
    const base = createKnowledgeBase({
      fileProcessorId: 'paddleocr',
      rerankModelId: 'jina::jina-reranker-v2-base-multilingual'
    })
    const { result } = renderHook(() => useKnowledgeRagConfig(base))

    expect(result.current.fileProcessorOptions).toEqual([{ value: 'paddleocr', label: 'PaddleOCR' }])
    expect(result.current.fileProcessorOptions.map((option) => option.value)).not.toContain('mineru')
    expect(result.current.fileProcessorOptions.map((option) => option.value)).not.toContain('doc2x')
    expect(result.current.fileProcessorOptions.map((option) => option.value)).not.toContain('mistral')
    expect(result.current.fileProcessorOptions.map((option) => option.value)).not.toContain('tesseract')
    expect(result.current.fileProcessorOptions.map((option) => option.value)).not.toContain('system')
    expect(result.current.fileProcessorOptions.map((option) => option.value)).not.toContain('ovocr')
    expect(mockUseMutation).toHaveBeenCalledWith('PATCH', '/knowledge-bases/:id', {
      refresh: ['/knowledge-bases']
    })

    await act(async () => {
      await result.current.save({
        fileProcessorId: null,
        chunkSize: '1536',
        chunkOverlap: '256',
        chunkStrategy: 'structured',
        chunkSeparator: '\\n\\n',
        embeddingModelId: 'voyage::voyage-3-large',
        rerankModelId: null,
        documentCount: 10,
        threshold: 0.25,
        searchMode: 'vector',
        hybridAlpha: null
      })
    })

    expect(mockTrigger).toHaveBeenCalledWith({
      params: { id: 'base-1' },
      body: {
        fileProcessorId: null,
        chunkSize: 1536,
        chunkOverlap: 256,
        rerankModelId: null,
        documentCount: 10,
        threshold: 0.25,
        searchMode: 'vector'
      }
    })
  })

  it('includes an explicit embedding model override in the patch body', async () => {
    const { result } = renderHook(() => useKnowledgeRagConfig(createKnowledgeBase()))

    await act(async () => {
      await result.current.save(result.current.initialValues, {
        embeddingModelId: 'voyage::voyage-3-large',
        dimensions: 2048
      })
    })

    expect(mockTrigger).toHaveBeenCalledWith({
      params: { id: 'base-1' },
      body: {
        embeddingModelId: 'voyage::voyage-3-large',
        dimensions: 2048
      }
    })
  })

  it('propagates save failures to the caller', async () => {
    const saveError = new Error('save failed')
    mockTrigger.mockRejectedValueOnce(saveError)
    const { result } = renderHook(() => useKnowledgeRagConfig(createKnowledgeBase()))

    await expect(result.current.save(result.current.initialValues)).rejects.toBe(saveError)
    expect(mockLogger.error).toHaveBeenCalledWith('Failed to update knowledge RAG config', saveError, {
      baseId: 'base-1',
      updates: {}
    })
  })

  it('builds a patch with only the changed search mode', async () => {
    const { result } = renderHook(() => useKnowledgeRagConfig(createKnowledgeBase()))

    await act(async () => {
      await result.current.save({
        ...result.current.initialValues,
        searchMode: 'vector'
      })
    })

    expect(mockTrigger).toHaveBeenCalledWith({
      params: { id: 'base-1' },
      body: {
        searchMode: 'vector'
      }
    })
  })
})
