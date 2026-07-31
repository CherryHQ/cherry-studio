import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { KnowledgeBase } from '@shared/data/types/knowledge'

import { useKnowledgeRagConfig } from '../useKnowledgeRagConfig'

const mockUseMutation = vi.fn()
const mockTrigger = vi.fn()
const mockUsePreference = vi.fn()
const mockUseAvailableFileProcessors = vi.hoisted(() => vi.fn())
const mockLogger = vi.hoisted(() => ({
  error: vi.fn()
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: (...args: unknown[]) => mockUseMutation(...args)
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (...args: unknown[]) => mockUsePreference(...args)
}))

vi.mock('@renderer/hooks/useAvailableFileProcessors', () => ({
  useAvailableFileProcessors: () => mockUseAvailableFileProcessors()
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
        'local-document': 'Local Document',
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
  threshold: 0.2,
  documentCount: 6,
  status: 'completed',
  error: null,
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
    mockUseAvailableFileProcessors.mockReturnValue({
      processorIds: new Set(['paddleocr', 'local-document', 'mineru', 'doc2x', 'mistral', 'open-mineru']),
      status: 'ready'
    })
  })

  it('marks unconfigured document processors as unavailable and exposes the save mutation', async () => {
    const base = createKnowledgeBase({
      fileProcessorId: 'paddleocr',
      rerankModelId: 'jina::jina-reranker-v2-base-multilingual'
    })
    const { result } = renderHook(() => useKnowledgeRagConfig(base))

    // `statusLabel` is what the row shows on the right; it must track `disabled`
    // so an unconfigured processor says why rather than looking merely greyed out.
    expect(result.current.fileProcessorOptions).toEqual([
      {
        value: 'local-document',
        label: 'Local Document',
        disabled: false,
        statusLabel: undefined
      },
      { value: 'paddleocr', label: 'PaddleOCR', disabled: false, statusLabel: undefined },
      { value: 'mineru', label: 'MinerU', disabled: true, statusLabel: 'knowledge.rag.processor_not_configured' },
      { value: 'doc2x', label: 'Doc2X', disabled: true, statusLabel: 'knowledge.rag.processor_not_configured' },
      { value: 'mistral', label: 'Mistral', disabled: true, statusLabel: 'knowledge.rag.processor_not_configured' },
      { value: 'open-mineru', label: 'Open MinerU', disabled: false, statusLabel: undefined }
    ])
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
        threshold: 0.4
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
        threshold: 0.4
      }
    })
  })

  it('includes Open MinerU without an API key because authentication is optional', () => {
    mockUsePreference.mockReturnValue([
      {
        'open-mineru': {
          capabilities: {
            document_to_markdown: {
              apiHost: 'http://127.0.0.1:8000'
            }
          }
        }
      }
    ])

    const { result } = renderHook(() => useKnowledgeRagConfig(createKnowledgeBase()))

    expect(result.current.fileProcessorOptions.find((option) => option.value === 'open-mineru')).toEqual({
      value: 'open-mineru',
      label: 'Open MinerU',
      disabled: false
    })
  })

  it('offers only processors reported as supported by main', () => {
    mockUseAvailableFileProcessors.mockReturnValue({
      processorIds: new Set(['paddleocr', 'mineru']),
      status: 'ready'
    })

    const { result } = renderHook(() =>
      useKnowledgeRagConfig(createKnowledgeBase({ fileProcessorId: 'local-document' }))
    )

    expect(result.current.fileProcessorOptions.map((option) => option.value)).toEqual(['paddleocr', 'mineru'])
  })

  it.each(['loading', 'error'] as const)(
    'keeps only the persisted processor visible and disabled when support is %s',
    (status) => {
      mockUseAvailableFileProcessors.mockReturnValue({ processorIds: new Set(), status })

      const { result } = renderHook(() =>
        useKnowledgeRagConfig(createKnowledgeBase({ fileProcessorId: 'local-document' }))
      )

      expect(result.current.fileProcessorOptions).toEqual([
        {
          value: 'local-document',
          label: 'Local Document',
          disabled: true,
          statusLabel: undefined
        }
      ])
    }
  )

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
})
