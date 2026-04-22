import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RagConfigPanel from '../RagConfigPanel'

const mockUseKnowledgeV2RagConfig = vi.fn()
const mockUseKnowledgeV2SaveRagConfig = vi.fn()
const mockSave = vi.fn()

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, loading, ...props }: { children: ReactNode; loading?: boolean; [key: string]: unknown }) => (
    <button {...props}>{loading ? 'loading' : children}</button>
  ),
  Scrollbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Input: (props: Record<string, unknown>) => <input {...props} />,
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Slider: ({
    value,
    onValueChange,
    min,
    max,
    step,
    disabled
  }: {
    value: number[]
    onValueChange?: (value: number[]) => void
    min?: number
    max?: number
    step?: number
    disabled?: boolean
  }) => (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={value[0]}
      onChange={(event) => onValueChange?.([Number(event.target.value)])}
    />
  )
}))

vi.mock('../../../hooks/useKnowledgeV2RagConfig', () => ({
  useKnowledgeV2RagConfig: (base: KnowledgeBase) => mockUseKnowledgeV2RagConfig(base)
}))

vi.mock('../../../hooks/useKnowledgeV2SaveRagConfig', () => ({
  useKnowledgeV2SaveRagConfig: (base: KnowledgeBase) => mockUseKnowledgeV2SaveRagConfig(base)
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'common.reset': '重置',
          'common.save': '保存',
          'common.saved': '已保存',
          'knowledge.error.failed_to_edit': '保存失败',
          'knowledge.not_set': '未设置',
          'knowledge.settings.preprocessing': '文档预处理',
          'knowledge.chunk_size': '分块大小',
          'knowledge.chunk_overlap': '分块重叠',
          'knowledge.chunk_size_change_warning': '修改分块参数后，旧文档需要重新处理',
          'knowledge.embedding_model': 'Embedding 模型',
          'knowledge.dimensions': '向量维度',
          'knowledge.document_count': '文档数量',
          'knowledge.threshold': '相似度阈值',
          'models.rerank_model': 'Rerank 模型',
          'knowledge_v2.rag.processor': '处理服务商',
          'knowledge_v2.rag.preprocessing_hint': '导入文档时自动执行预处理',
          'knowledge_v2.rag.chunking': '分块规则',
          'knowledge_v2.rag.retrieval': '检索设置',
          'knowledge_v2.rag.tokens_unit': 'tokens',
          'knowledge_v2.rag.search_mode.title': '检索模式',
          'knowledge_v2.rag.search_mode.default': '向量检索',
          'knowledge_v2.rag.search_mode.bm25': '全文检索',
          'knowledge_v2.rag.search_mode.hybrid': '混合检索（推荐）',
          'knowledge_v2.rag.hybrid_alpha': 'Hybrid Alpha',
          'knowledge_v2.rag.hybrid_alpha_hint': '仅在 Hybrid 检索模式下可配置',
          'knowledge_v2.rag.chunk_size_invalid': '分块大小必须大于 0',
          'knowledge_v2.rag.chunk_overlap_invalid': '分块重叠必须大于等于 0',
          'knowledge_v2.rag.chunk_overlap_requires_chunk_size': '分块重叠依赖分块大小',
          'knowledge_v2.rag.chunk_overlap_must_be_smaller': '分块重叠必须小于分块大小'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBase>): KnowledgeBase => ({
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
  threshold: 0.1,
  documentCount: 6,
  searchMode: 'default',
  hybridAlpha: undefined,
  createdAt: '2026-04-15T09:00:00+08:00',
  updatedAt: '2026-04-15T09:00:00+08:00',
  ...overrides
})

describe('RagConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, {
      toast: {
        success: vi.fn(),
        error: vi.fn()
      }
    })

    mockUseKnowledgeV2RagConfig.mockReturnValue({
      initialValues: {
        fileProcessorId: null,
        chunkSize: '512',
        chunkOverlap: '64',
        embeddingModelId: 'openai::text-embedding-3-small',
        rerankModelId: null,
        dimensions: 1536,
        documentCount: 6,
        threshold: 0.1,
        searchMode: 'default',
        hybridAlpha: null
      },
      fileProcessorOptions: [{ value: 'doc2x', label: 'Doc2X' }],
      embeddingModelOptions: [{ value: 'openai::text-embedding-3-small', label: 'text-embedding-3-small · OpenAI' }],
      rerankModelOptions: [{ value: 'jina::rerank', label: 'jina-rerank · Jina AI' }]
    })
    mockUseKnowledgeV2SaveRagConfig.mockReturnValue({
      save: mockSave,
      isLoading: false,
      error: undefined
    })
  })

  it('removes separator rule UI, hides hybrid alpha outside hybrid mode, and saves through the phase3 hook', async () => {
    render(<RagConfigPanel base={createKnowledgeBase({})} />)

    expect(screen.queryByText('separatorRule')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('1536')).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: '刷新' })).not.toBeInTheDocument()
    expect(screen.queryByText('Hybrid Alpha')).not.toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('512'), { target: { value: '1024' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          chunkSize: '1024'
        })
      )
    })
    expect(window.toast.success).toHaveBeenCalledWith('已保存')
  })

  it('shows hybrid alpha when the current search mode is hybrid', () => {
    mockUseKnowledgeV2RagConfig.mockReturnValueOnce({
      initialValues: {
        fileProcessorId: null,
        chunkSize: '512',
        chunkOverlap: '64',
        embeddingModelId: 'openai::text-embedding-3-small',
        rerankModelId: null,
        dimensions: 1536,
        documentCount: 6,
        threshold: 0.1,
        searchMode: 'hybrid',
        hybridAlpha: 0.6
      },
      fileProcessorOptions: [{ value: 'doc2x', label: 'Doc2X' }],
      embeddingModelOptions: [{ value: 'openai::text-embedding-3-small', label: 'text-embedding-3-small · OpenAI' }],
      rerankModelOptions: [{ value: 'jina::rerank', label: 'jina-rerank · Jina AI' }]
    })

    render(<RagConfigPanel base={createKnowledgeBase({ searchMode: 'hybrid', hybridAlpha: 0.6 })} />)

    expect(screen.getByText('Hybrid Alpha')).toBeInTheDocument()
  })
})
