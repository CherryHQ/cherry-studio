import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RagConfigPanel from '../RagConfigPanel'

const mockUseKnowledgeRagConfig = vi.fn()
const mockSave = vi.fn()

const renderRagConfigPanel = (onRestoreBase = vi.fn(), baseOverrides: Partial<KnowledgeBase> = {}) => {
  return render(<RagConfigPanel base={createKnowledgeBase(baseOverrides)} onRestoreBase={onRestoreBase} />)
}

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{ onValueChange?: (value: string) => void }>({})

  return {
    Button: ({ children, loading, ...props }: { children: ReactNode; loading?: boolean; [key: string]: unknown }) => (
      <button {...props}>{loading ? 'loading' : children}</button>
    ),
    FieldError: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <div role="alert" {...props}>
        {children}
      </div>
    ),
    Label: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <label {...props}>{children}</label>
    ),
    Scrollbar: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
    Input: (props: Record<string, unknown>) => <input {...props} />,
    Select: ({
      children,
      onValueChange
    }: {
      children: ReactNode
      onValueChange?: (value: string) => void
      value?: string
    }) => <SelectContext value={{ onValueChange }}>{children}</SelectContext>,
    SelectTrigger: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: ReactNode; value: string }) => {
      const { onValueChange } = React.use(SelectContext)
      return (
        <button type="button" onClick={() => onValueChange?.(value)}>
          {children}
        </button>
      )
    },
    Tooltip: ({ children, content }: { children: ReactNode; content?: ReactNode }) => (
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
      disabled,
      ...props
    }: {
      value: number[]
      onValueChange?: (value: number[]) => void
      min?: number
      max?: number
      step?: number
      disabled?: boolean
      [key: string]: unknown
    }) => (
      <input
        {...props}
        type="range"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={value[0]}
        onChange={(event) => onValueChange?.([Number(event.target.value)])}
      />
    )
  }
})

vi.mock('../../../hooks', () => ({
  useKnowledgeRagConfig: (base: KnowledgeBase) => mockUseKnowledgeRagConfig(base)
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'knowledge_v2.error.failed_base_unknown': '该知识库迁移失败，请重建知识库并选择新的嵌入模型。',
          'knowledge_v2.error.failed_to_edit': '保存失败',
          'knowledge_v2.error.missing_embedding_model':
            '迁移时未找到原知识库使用的嵌入模型，请重建知识库并选择新的嵌入模型。',
          'knowledge_v2.not_set': '未设置',
          'knowledge_v2.embedding_model': 'Embedding 模型',
          'knowledge_v2.dimensions': '向量维度',
          'knowledge_v2.restore.action': '重建知识库',
          'knowledge_v2.restore.submit': '重建',
          'knowledge_v2.status.failed': '失败',
          'knowledge.dimensions_error_invalid': '无效的嵌入维度',
          'knowledge_v2.rag.dimensions': '向量维度',
          'knowledge_v2.rag.document_count': '请求文档片段数 (Top K)',
          'knowledge_v2.rag.embedding_model': 'Embedding 模型',
          'knowledge_v2.rag.embedding_model_select': '模型选择',
          'knowledge_v2.rag.file_processing': '文档预处理',
          'knowledge_v2.rag.file_processing_hint':
            '文档预处理将在文档导入时自动执行，选择合适的处理服务商可提升文档解析质量',
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
          'knowledge_v2.rag.refresh_dimensions': '刷新向量维度',
          'knowledge_v2.rag.rerank_disabled': '不使用',
          'knowledge_v2.rag.rerank_model': '重排模型 (Rerank)',
          'knowledge_v2.rag.reset_action': '恢复默认',
          'knowledge_v2.rag.save_action': '保存',
          'knowledge_v2.rag.saved': '已保存',
          'knowledge_v2.rag.hints.embedding_model': '用于将知识库内容转换为向量。',
          'knowledge_v2.rag.hints.dimensions': '当前嵌入模型输出的向量维度。',
          'knowledge_v2.rag.hints.processor': '导入文件时使用的解析处理服务。',
          'knowledge_v2.rag.hints.chunk_size': '单个文档片段的目标 token 数。',
          'knowledge_v2.rag.hints.chunk_overlap': '相邻文档片段之间保留的重叠 token 数。',
          'knowledge_v2.rag.hints.document_count': '每次召回返回的最大文档片段数。',
          'knowledge_v2.rag.hints.threshold': '过滤低相关片段的相似度阈值。',
          'knowledge_v2.rag.hints.threshold_disabled': '该检索模式按排序返回结果，不使用相似度阈值。',
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
        dimensions: '1536',
        documentCount: 6,
        threshold: 0.1,
        searchMode: 'default',
        hybridAlpha: null
      },
      fileProcessorOptions: [{ value: 'doc2x', label: 'Doc2X' }],
      embeddingModelOptions: [
        { value: 'openai::text-embedding-3-small', label: 'text-embedding-3-small · openai' },
        { value: 'voyage::voyage-3-large', label: 'voyage-3-large · voyage' }
      ],
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

  it('renders only the failure hint and restore action for failed bases', () => {
    const onRestoreBase = vi.fn()

    renderRagConfigPanel(onRestoreBase, {
      status: 'failed',
      error: 'missing_embedding_model',
      embeddingModelId: null,
      dimensions: null
    })

    expect(screen.getByText('失败')).toBeInTheDocument()
    expect(screen.getByTestId('rag-failed-state').parentElement?.parentElement).toHaveClass(
      'items-center',
      'justify-center'
    )
    expect(screen.getByText('迁移时未找到原知识库使用的嵌入模型，请重建知识库并选择新的嵌入模型。')).toBeInTheDocument()
    expect(screen.queryByText('文档预处理')).not.toBeInTheDocument()
    expect(screen.queryByText('分块规则')).not.toBeInTheDocument()
    expect(screen.queryByText('Embedding 模型')).not.toBeInTheDocument()
    expect(screen.queryByText('检索设置')).not.toBeInTheDocument()
    expect(mockUseKnowledgeRagConfig).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '重建知识库' }))

    expect(onRestoreBase).toHaveBeenCalledWith(expect.objectContaining({ id: 'base-1', status: 'failed' }))
  })

  it('renders current chunk values, hides hybrid alpha outside hybrid mode, and saves through the phase3 hook', async () => {
    renderRagConfigPanel()

    expect(screen.queryByText('separatorRule')).not.toBeInTheDocument()
    expect(screen.queryByText('分隔符规则')).not.toBeInTheDocument()
    expect(screen.getByText('文档预处理')).toBeInTheDocument()
    expect(screen.getByText('请求文档片段数 (Top K)')).toBeInTheDocument()
    expect(screen.getByText('重排模型 (Rerank)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '不使用' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'text-embedding-3-small · openai' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('1536')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刷新向量维度' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '获取嵌入维度' })).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('512')).toBeInTheDocument()
    expect(screen.getByDisplayValue('64')).toBeInTheDocument()
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

  it('shows save failure toast with the original error', async () => {
    mockSave.mockRejectedValueOnce(new Error('save failed'))

    renderRagConfigPanel()

    fireEvent.change(screen.getByDisplayValue('512'), { target: { value: '1024' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('保存失败: save failed')
    })
  })

  it('applies the compact visual treatment from the RAG design draft', () => {
    const { container } = renderRagConfigPanel()

    expect(screen.getByText('文档预处理').parentElement).toHaveClass('font-medium', 'text-sm')
    expect(screen.getByText('处理服务商')).toHaveClass('text-xs', 'text-foreground')
    expect(container.querySelector('button.h-7\\.5.text-xs.font-medium')).toBeInTheDocument()
    expect(screen.getByDisplayValue('512')).toHaveClass('h-7.5', 'text-xs', 'shadow-xs')
    expect(screen.getAllByText('tokens')[0]).toHaveClass('text-muted-foreground/50', 'text-xs')
    expect(screen.getByText('文档预处理').parentElement?.querySelector('svg')).not.toHaveClass('text-primary/70')
    const fileProcessingHint = screen.getByText(
      '文档预处理将在文档导入时自动执行，选择合适的处理服务商可提升文档解析质量'
    )
    expect(fileProcessingHint).toHaveClass('text-muted-foreground/70', 'text-xs')
    expect(fileProcessingHint.parentElement).toHaveClass('bg-success/5', 'border-success/20')
    expect(screen.getByRole('slider', { name: '请求文档片段数 (Top K)' })).toHaveClass('w-full')
    expect(screen.getByText('6')).toHaveClass('text-primary/80', 'text-xs')
    expect(screen.getByRole('button', { name: '恢复默认' })).toHaveClass('h-6', 'text-xs', 'font-medium')
    expect(screen.getByRole('button', { name: '保存' })).toHaveClass('h-9', 'text-sm', 'font-medium')
  })

  it('disables save when a required chunk field is cleared or becomes non-positive', () => {
    renderRagConfigPanel()

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
    renderRagConfigPanel()

    const saveButton = screen.getByRole('button', { name: '保存' })

    fireEvent.change(screen.getByDisplayValue('64'), { target: { value: '512' } })

    expect(screen.getByText('分块重叠必须小于分块大小')).toBeInTheDocument()
    expect(saveButton).toBeDisabled()

    fireEvent.click(saveButton)
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('opens rebuild dialog instead of patching when embedding config changes', () => {
    const onRestoreBase = vi.fn()

    renderRagConfigPanel(onRestoreBase)

    fireEvent.click(screen.getByRole('button', { name: 'voyage-3-large · voyage' }))
    expect(screen.getByRole('button', { name: '重建' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重建' }))

    expect(mockSave).not.toHaveBeenCalled()
    expect(onRestoreBase).toHaveBeenCalledWith(expect.objectContaining({ id: 'base-1' }), {
      embeddingModelId: 'voyage::voyage-3-large',
      dimensions: 1536
    })
  })

  it('opens rebuild dialog and changes the action label when dimensions change', () => {
    const onRestoreBase = vi.fn()

    renderRagConfigPanel(onRestoreBase)

    fireEvent.change(screen.getByDisplayValue('1536'), { target: { value: '4096' } })
    expect(screen.getByRole('button', { name: '重建' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重建' }))

    expect(mockSave).not.toHaveBeenCalled()
    expect(onRestoreBase).toHaveBeenCalledWith(expect.objectContaining({ id: 'base-1' }), {
      embeddingModelId: 'openai::text-embedding-3-small',
      dimensions: 4096
    })
  })

  it('renders hover hint tooltip content for RAG field labels', () => {
    renderRagConfigPanel()

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
        dimensions: '1536',
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

    render(
      <RagConfigPanel base={createKnowledgeBase({ searchMode: 'hybrid', hybridAlpha: 0.6 })} onRestoreBase={vi.fn()} />
    )

    expect(screen.getByText('Hybrid Alpha')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: '相似度阈值' })).toBeDisabled()
    expect(screen.getByRole('tooltip', { name: '该检索模式按排序返回结果，不使用相似度阈值。' })).toBeInTheDocument()
  })
})
