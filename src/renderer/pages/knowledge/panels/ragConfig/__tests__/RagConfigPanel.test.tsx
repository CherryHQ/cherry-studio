import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RagConfigPanel from '../RagConfigPanel'

const mockUseKnowledgeRagConfig = vi.fn()
const mockSave = vi.fn()
const mockEmbedMany = vi.fn()

const renderRagConfigPanel = (onRestoreBase = vi.fn(), baseOverrides: Partial<KnowledgeBase> = {}) => {
  return render(<RagConfigPanel base={createKnowledgeBase(baseOverrides)} onRestoreBase={onRestoreBase} />)
}

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{ onValueChange?: (value: string) => void }>({})

  return {
    Alert: ({
      action,
      description,
      message,
      ...props
    }: {
      action?: ReactNode
      description?: ReactNode
      message?: ReactNode
      [key: string]: unknown
    }) => (
      <div {...props}>
        <div>{message}</div>
        <div>{description}</div>
        {action}
      </div>
    ),
    Button: ({
      children,
      loading,
      type = 'button',
      ...props
    }: {
      children: ReactNode
      loading?: boolean
      type?: 'button' | 'submit' | 'reset'
      [key: string]: unknown
    }) => (
      <button type={type} {...props}>
        {loading ? 'loading' : children}
      </button>
    ),
    DialogFooter: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
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
  useKnowledgeRagConfig: (base: KnowledgeBase) => mockUseKnowledgeRagConfig(base),
  useEmbeddingDimensions: () => ({
    fetchDimensions: async (uniqueModelId: string) => {
      const { embeddings } = await window.api.ai.embedMany({
        uniqueModelId,
        values: ['test']
      })
      return embeddings[0]?.length ?? 0
    },
    isFetchingDimensions: false
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'knowledge.error.failed_base_unknown': '该知识库迁移失败，请重建知识库并选择新的嵌入模型。',
          'knowledge.error.failed_to_edit': '保存失败',
          'knowledge.error.missing_embedding_model':
            '迁移时未找到原知识库使用的嵌入模型，请重建知识库并选择新的嵌入模型。',
          'knowledge.not_set': '未设置',
          'knowledge.embedding_model': '嵌入模型',
          'knowledge.embedding_model_required': '请选择嵌入模型',
          'knowledge.provider_not_found': '找不到提供商',
          'knowledge.dimensions': '向量维度',
          'message.error.get_embedding_dimensions': '获取嵌入维度失败',
          'knowledge.restore.action': '重建知识库',
          'knowledge.restore.submit': '重建',
          'knowledge.status.failed': '失败',
          'knowledge.dimensions_error_invalid': '无效的嵌入维度',
          'knowledge.rag.dimensions': '向量维度',
          'knowledge.rag.document_count': '请求文档片段数 (Top K)',
          'knowledge.rag.embedding_model': '嵌入模型',
          'knowledge.rag.embedding_model_select': '模型选择',
          'knowledge.rag.file_processing': '文档处理',
          'knowledge.rag.file_processing_hint':
            '文档预处理将在文档导入时自动执行，选择合适的处理服务商可提升文档解析质量',
          'knowledge.rag.processor': '处理服务商',
          'knowledge.rag.chunk_size': '分块大小',
          'knowledge.rag.chunk_overlap': '分块重叠',
          'knowledge.rag.chunk_size_change_warning': '分段大小和重叠大小修改只针对新添加的内容有效',
          'knowledge.rag.chunking': 'Chunking',
          'knowledge.rag.retrieval': 'Retrieval',
          'knowledge.rag.threshold': '相似度阈值',
          'knowledge.rag.tokens_unit': 'tokens',
          'knowledge.rag.search_mode.title': '检索模式',
          'knowledge.rag.search_mode.default': '向量检索',
          'knowledge.rag.search_mode.bm25': '全文检索',
          'knowledge.rag.search_mode.hybrid': '混合检索（推荐）',
          'knowledge.rag.hybrid_alpha': 'Hybrid Alpha',
          'knowledge.rag.hybrid_alpha_hint': '仅在 Hybrid 检索模式下可配置',
          'knowledge.rag.refresh_dimensions': '刷新向量维度',
          'knowledge.rag.rerank_disabled': '不使用',
          'knowledge.rag.rerank_model': '重排模型 (Rerank)',
          'knowledge.rag.reset_action': '恢复默认',
          'knowledge.rag.save_action': '保存',
          'knowledge.rag.saved': '已保存',
          'knowledge.rag.hints.embedding_model': '用于将知识库内容转换为向量。',
          'knowledge.rag.hints.dimensions': '当前嵌入模型输出的向量维度。',
          'knowledge.rag.hints.processor': '导入文件时使用的解析处理服务。',
          'knowledge.rag.hints.chunk_size': '单个文档片段的目标 token 数。',
          'knowledge.rag.hints.chunk_overlap': '相邻文档片段之间保留的重叠 token 数。',
          'knowledge.rag.hints.document_count': '每次召回返回的最大文档片段数。',
          'knowledge.rag.hints.threshold': '过滤低相关片段的相似度阈值。',
          'knowledge.rag.hints.threshold_disabled': '该检索模式按排序返回结果，不使用相似度阈值。',
          'knowledge.rag.hints.search_mode': '选择召回方式。',
          'knowledge.rag.hints.hybrid_alpha': '混合检索中向量得分的权重。',
          'knowledge.rag.hints.rerank_model': '对初步召回结果重新排序的模型。',
          'knowledge.rag.chunk_size_invalid': '分块大小必须大于 0',
          'knowledge.rag.chunk_overlap_invalid': '分块重叠必须大于等于 0',
          'knowledge.rag.chunk_overlap_must_be_smaller': '分块重叠必须小于分块大小'
        }) as Record<string, string>
      )[key] ?? key
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
    mockEmbedMany.mockResolvedValue({ embeddings: [new Array(2048).fill(0)] })
    Object.assign(window, {
      toast: {
        success: vi.fn(),
        error: vi.fn()
      },
      api: {
        ...(window as unknown as { api?: Record<string, unknown> }).api,
        ai: {
          ...(window as unknown as { api?: { ai?: Record<string, unknown> } }).api?.ai,
          embedMany: mockEmbedMany
        }
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
      embeddingModels: [
        {
          id: 'openai::text-embedding-3-small',
          providerId: 'openai',
          apiModelId: 'text-embedding-3-small',
          name: 'text-embedding-3-small',
          capabilities: [MODEL_CAPABILITY.EMBEDDING],
          endpointTypes: [ENDPOINT_TYPE.OPENAI_EMBEDDINGS],
          supportsStreaming: false,
          isEnabled: true,
          isHidden: false
        },
        {
          id: 'voyage::voyage-3-large',
          providerId: 'voyage',
          apiModelId: 'voyage-3-large',
          name: 'voyage-3-large',
          capabilities: [MODEL_CAPABILITY.EMBEDDING],
          endpointTypes: [ENDPOINT_TYPE.OPENAI_EMBEDDINGS],
          supportsStreaming: false,
          isEnabled: true,
          isHidden: false
        }
      ],
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
    expect(screen.queryByText('文档处理')).not.toBeInTheDocument()
    expect(screen.queryByText('分块大小')).not.toBeInTheDocument()
    expect(screen.queryByText('嵌入模型')).not.toBeInTheDocument()
    expect(screen.queryByText('请求文档片段数 (Top K)')).not.toBeInTheDocument()
    expect(mockUseKnowledgeRagConfig).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '重建知识库' }))

    expect(onRestoreBase).toHaveBeenCalledWith(expect.objectContaining({ id: 'base-1', status: 'failed' }))
  })

  it('renders current chunk values, hides hybrid alpha outside hybrid mode, and saves through the phase3 hook', async () => {
    renderRagConfigPanel()

    expect(screen.queryByText('separatorRule')).not.toBeInTheDocument()
    expect(screen.queryByText('分隔符规则')).not.toBeInTheDocument()
    expect(screen.getByText('文档处理')).toBeInTheDocument()
    expect(screen.getByText('请求文档片段数 (Top K)')).toBeInTheDocument()
    expect(screen.getByText('重排模型 (Rerank)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '不使用' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'text-embedding-3-small · openai' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('1536')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刷新向量维度' })).not.toBeDisabled()
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

  it('uses the mini-apps style flat field layout', () => {
    renderRagConfigPanel()

    // Each field label is now a strong text-sm font-medium label (mini-apps FieldLabel parity).
    expect(screen.getByText('文档处理')).toHaveClass('font-medium', 'text-sm')
    expect(screen.getByText('分块大小')).toHaveClass('font-medium', 'text-sm')
    expect(screen.getByText('嵌入模型')).toHaveClass('font-medium', 'text-sm')
    expect(screen.getByText('请求文档片段数 (Top K)')).toHaveClass('font-medium', 'text-sm')
    // Section-level small-caps headings are gone — no Chunking / Embedding / Retrieval section title in the DOM.
    expect(screen.queryByText('Chunking')).not.toBeInTheDocument()
    expect(screen.queryByText('Embedding')).not.toBeInTheDocument()
    expect(screen.queryByText('Retrieval')).not.toBeInTheDocument()
    // Chunk warning is still rendered as a muted hint paragraph.
    expect(screen.getAllByText('分段大小和重叠大小修改只针对新添加的内容有效')).toHaveLength(1)
    expect(screen.getByText('分段大小和重叠大小修改只针对新添加的内容有效')).toHaveClass(
      'text-foreground-muted',
      'text-xs'
    )
    expect(screen.getByRole('slider', { name: '请求文档片段数 (Top K)' })).toHaveClass('w-full')
    expect(screen.getByText('6')).toHaveClass('text-foreground-secondary', 'text-xs')
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

  it('clears dimensions and opens rebuild dialog without old dimensions when embedding model changes', () => {
    const onRestoreBase = vi.fn()

    renderRagConfigPanel(onRestoreBase)

    fireEvent.click(screen.getByRole('button', { name: 'voyage-3-large · voyage' }))
    expect(screen.getByDisplayValue('')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重建' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重建' }))

    expect(mockSave).not.toHaveBeenCalled()
    expect(onRestoreBase).toHaveBeenCalledWith(expect.objectContaining({ id: 'base-1' }), {
      embeddingModelId: 'voyage::voyage-3-large'
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

  it('refreshes embedding dimensions and opens the rebuild flow with the fetched value', async () => {
    const onRestoreBase = vi.fn()

    renderRagConfigPanel(onRestoreBase)

    fireEvent.click(screen.getByRole('button', { name: '刷新向量维度' }))

    await waitFor(() => {
      expect(mockEmbedMany).toHaveBeenCalledWith({
        uniqueModelId: 'openai::text-embedding-3-small',
        values: ['test']
      })
      expect(screen.getByDisplayValue('2048')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '重建' }))

    expect(mockSave).not.toHaveBeenCalled()
    expect(onRestoreBase).toHaveBeenCalledWith(expect.objectContaining({ id: 'base-1' }), {
      embeddingModelId: 'openai::text-embedding-3-small',
      dimensions: 2048
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

  it('hides threshold for hybrid search mode without rerank', () => {
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
      embeddingModels: [
        {
          id: 'openai::text-embedding-3-small',
          providerId: 'openai',
          apiModelId: 'text-embedding-3-small',
          name: 'text-embedding-3-small',
          capabilities: [MODEL_CAPABILITY.EMBEDDING],
          endpointTypes: [ENDPOINT_TYPE.OPENAI_EMBEDDINGS],
          supportsStreaming: false,
          isEnabled: true,
          isHidden: false
        }
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
    expect(screen.queryByRole('slider', { name: '相似度阈值' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('tooltip', { name: '该检索模式按排序返回结果，不使用相似度阈值。' })
    ).not.toBeInTheDocument()
  })

  it('shows threshold for hybrid search mode when rerank is configured', async () => {
    mockUseKnowledgeRagConfig.mockReturnValue({
      initialValues: {
        fileProcessorId: null,
        chunkSize: '512',
        chunkOverlap: '64',
        embeddingModelId: 'openai::text-embedding-3-small',
        rerankModelId: 'jina::rerank',
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
      embeddingModels: [
        {
          id: 'openai::text-embedding-3-small',
          providerId: 'openai',
          apiModelId: 'text-embedding-3-small',
          name: 'text-embedding-3-small',
          capabilities: [MODEL_CAPABILITY.EMBEDDING],
          endpointTypes: [ENDPOINT_TYPE.OPENAI_EMBEDDINGS],
          supportsStreaming: false,
          isEnabled: true,
          isHidden: false
        }
      ],
      rerankModelOptions: [{ value: 'jina::rerank', label: 'rerank · jina' }],
      save: mockSave,
      isLoading: false,
      error: undefined
    })

    render(
      <RagConfigPanel
        base={createKnowledgeBase({ searchMode: 'hybrid', hybridAlpha: 0.6, rerankModelId: 'jina::rerank' })}
        onRestoreBase={vi.fn()}
      />
    )

    fireEvent.change(screen.getByRole('slider', { name: '相似度阈值' }), { target: { value: '0.7' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          rerankModelId: 'jina::rerank',
          threshold: 0.7
        })
      )
    })
  })
})
