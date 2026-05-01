import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RagConfigPanel from '../RagConfigPanel'

const mockUseKnowledgeRagConfig = vi.fn()
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
  NormalTooltip: ({ children, content }: { children: ReactNode; content?: ReactNode }) => (
    <span>
      {children}
      {content ? <span role="tooltip">{content}</span> : null}
    </span>
  ),
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

vi.mock('../../../hooks', () => ({
  useKnowledgeRagConfig: (base: KnowledgeBase) => mockUseKnowledgeRagConfig(base)
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'common.reset': '重置',
          'common.save': '保存',
          'common.saved': '已保存',
          'knowledge_v2.error.failed_to_edit': '保存失败',
          'knowledge_v2.not_set': '未设置',
          'knowledge_v2.embedding_model': 'Embedding 模型',
          'knowledge_v2.dimensions': '向量维度',
          'models.rerank_model': 'Rerank 模型',
          'knowledge_v2.rag.document_count': '文档数量',
          'knowledge_v2.rag.file_processing': '文件处理',
          'knowledge_v2.rag.file_processing_hint':
            '文件处理会在文档导入时自动执行，选择合适的处理服务商可提升文档解析质量',
          'knowledge_v2.rag.processor': '处理服务商',
          'knowledge_v2.rag.chunk_size': '分块大小',
          'knowledge_v2.rag.chunk_overlap': '分块重叠',
          'knowledge_v2.rag.chunk_size_change_warning': '修改分块参数后，旧文档需要重新处理',
          'knowledge_v2.rag.chunking': '分块规则',
          'knowledge_v2.rag.retrieval': '检索设置',
          'knowledge_v2.rag.threshold': '相似度阈值',
          'knowledge_v2.rag.tokens_unit': 'tokens',
          'knowledge_v2.rag.search_mode.title': '检索模式',
          'knowledge_v2.rag.search_mode.default': '向量检索',
          'knowledge_v2.rag.search_mode.bm25': '全文检索',
          'knowledge_v2.rag.search_mode.hybrid': '混合检索（推荐）',
          'knowledge_v2.rag.hybrid_alpha': 'Hybrid Alpha',
          'knowledge_v2.rag.hybrid_alpha_hint': '仅在 Hybrid 检索模式下可配置',
          'knowledge_v2.rag.hints.embedding_model': '用于将知识库内容转换为向量。',
          'knowledge_v2.rag.hints.dimensions': '当前嵌入模型输出的向量维度。',
          'knowledge_v2.rag.hints.processor': '导入文件时使用的解析处理服务。',
          'knowledge_v2.rag.hints.chunk_size': '单个文档片段的目标 token 数。',
          'knowledge_v2.rag.hints.chunk_overlap': '相邻文档片段之间保留的重叠 token 数。',
          'knowledge_v2.rag.hints.document_count': '每次召回返回的最大文档片段数。',
          'knowledge_v2.rag.hints.threshold': '过滤低相关片段的相似度阈值。',
          'knowledge_v2.rag.hints.search_mode': '选择召回方式。',
          'knowledge_v2.rag.hints.hybrid_alpha': '混合检索中向量得分的权重。',
          'knowledge_v2.rag.hints.rerank_model': '对初步召回结果重新排序的模型。',
          'knowledge_v2.rag.chunk_size_invalid': '分块大小必须大于 0',
          'knowledge_v2.rag.chunk_overlap_invalid': '分块重叠必须大于等于 0',
          'knowledge_v2.rag.chunk_overlap_must_be_smaller': '分块重叠必须小于分块大小'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  id: 'base-1',
  name: 'Base 1',
  groupId: null,
  emoji: '📁',
  dimensions: 1536,
  embeddingModelId: 'openai::text-embedding-3-small',
  rerankModelId: undefined,
  fileProcessorId: undefined,
  chunkSize: 1024,
  chunkOverlap: 200,
  threshold: 0.1,
  documentCount: 6,
  status: 'completed',
  error: null,
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

    mockUseKnowledgeRagConfig.mockReturnValue({
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
      embeddingModelOptions: [{ value: 'openai::text-embedding-3-small', label: 'text-embedding-3-small · openai' }],
      searchModeOptions: [
        { value: 'hybrid', label: '混合检索（推荐）' },
        { value: 'default', label: '向量检索' },
        { value: 'bm25', label: '全文检索' }
      ],
      rerankModelOptions: [{ value: 'jina::rerank', label: 'rerank · jina' }],
      save: mockSave,
      isLoading: false,
      error: undefined
    })
  })

  it('renders current chunk values, hides hybrid alpha outside hybrid mode, and saves through the phase3 hook', async () => {
    render(<RagConfigPanel base={createKnowledgeBase({})} />)

    expect(screen.queryByText('separatorRule')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('text-embedding-3-small · openai')).toHaveAttribute('readonly')
    expect(screen.getByDisplayValue('1536')).toHaveAttribute('readonly')
    expect(screen.getByDisplayValue('512')).toBeInTheDocument()
    expect(screen.getByDisplayValue('64')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '刷新' })).not.toBeInTheDocument()
    expect(screen.queryByText('Hybrid Alpha')).not.toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('512'), { target: { value: '1024' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          chunkSize: '1024',
          chunkOverlap: '64'
        })
      )
    })
    expect(window.toast.success).toHaveBeenCalledWith('已保存')
  })

  it('disables save when a required chunk field is cleared or becomes non-positive', () => {
    render(<RagConfigPanel base={createKnowledgeBase({})} />)

    const chunkSizeInput = screen.getByDisplayValue('512')
    const saveButton = screen.getByRole('button', { name: '保存' })

    fireEvent.change(chunkSizeInput, { target: { value: '' } })

    expect(saveButton).toBeDisabled()

    fireEvent.click(saveButton)
    expect(mockSave).not.toHaveBeenCalled()

    fireEvent.change(chunkSizeInput, { target: { value: '0' } })

    expect(screen.getByText('分块大小必须大于 0')).toBeInTheDocument()
    expect(saveButton).toBeDisabled()
  })

  it('blocks save when chunk overlap is not smaller than chunk size', () => {
    render(<RagConfigPanel base={createKnowledgeBase({})} />)

    const saveButton = screen.getByRole('button', { name: '保存' })

    fireEvent.change(screen.getByDisplayValue('64'), { target: { value: '512' } })

    expect(screen.getByText('分块重叠必须小于分块大小')).toBeInTheDocument()
    expect(saveButton).toBeDisabled()

    fireEvent.click(saveButton)
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('renders hover hint tooltip content for RAG field labels', () => {
    render(<RagConfigPanel base={createKnowledgeBase({})} />)

    expect(screen.getByRole('tooltip', { name: '用于将知识库内容转换为向量。' })).toBeInTheDocument()
    expect(screen.getByRole('tooltip', { name: '每次召回返回的最大文档片段数。' })).toBeInTheDocument()
    expect(screen.getByRole('tooltip', { name: '过滤低相关片段的相似度阈值。' })).toBeInTheDocument()
    expect(screen.getByRole('tooltip', { name: '选择召回方式。' })).toBeInTheDocument()
    expect(screen.getByRole('tooltip', { name: '对初步召回结果重新排序的模型。' })).toBeInTheDocument()
    expect(screen.queryByRole('tooltip', { name: '混合检索中向量得分的权重。' })).not.toBeInTheDocument()
  })

  it('shows hybrid alpha when the current search mode is hybrid', () => {
    mockUseKnowledgeRagConfig.mockReturnValueOnce({
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
      embeddingModelOptions: [{ value: 'openai::text-embedding-3-small', label: 'text-embedding-3-small · openai' }],
      searchModeOptions: [
        { value: 'hybrid', label: '混合检索（推荐）' },
        { value: 'default', label: '向量检索' },
        { value: 'bm25', label: '全文检索' }
      ],
      rerankModelOptions: [{ value: 'jina::rerank', label: 'rerank · jina' }],
      save: mockSave,
      isLoading: false,
      error: undefined
    })

    render(<RagConfigPanel base={createKnowledgeBase({ searchMode: 'hybrid', hybridAlpha: 0.6 })} />)

    expect(screen.getByText('Hybrid Alpha')).toBeInTheDocument()
  })
})
