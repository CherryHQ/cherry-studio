import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RagConfigPanel from '../RagConfigPanel'

const mockUseKnowledgeRagConfig = vi.fn()
const mockSave = vi.fn()
// embedMany goes through ipcApi.request('ai.embed_many', …) now (Main IPC).
const { mockEmbedMany } = vi.hoisted(() => ({ mockEmbedMany: vi.fn() }))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (_route: string, input: unknown) => mockEmbedMany(input) }
}))

const renderRagConfigPanel = (
  onRestoreBase = vi.fn(),
  baseOverrides: Partial<KnowledgeBase> = {},
  itemCount?: number
) => {
  return render(
    <RagConfigPanel base={createKnowledgeBase(baseOverrides)} itemCount={itemCount} onRestoreBase={onRestoreBase} />
  )
}

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{ onValueChange?: (value: string) => void }>({})

  return {
    // The accordion is mocked to always render its content so field-level
    // assertions stay independent of the collapsed/expanded state.
    Accordion: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AccordionItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AccordionTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
    AccordionContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
    Switch: ({
      checked,
      onCheckedChange,
      ...props
    }: {
      checked?: boolean
      onCheckedChange?: (checked: boolean) => void
      [key: string]: unknown
    }) => (
      <input
        type="checkbox"
        role="switch"
        checked={checked ?? false}
        onChange={(event) => onCheckedChange?.(event.target.checked)}
        {...props}
      />
    ),
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
      const { embeddings } = await mockEmbedMany({
        uniqueModelId,
        values: ['test']
      })
      return embeddings[0]?.length ?? 0
    },
    isFetchingDimensions: false
  })
}))

vi.mock('../../../components/KnowledgeModelSelect', () => ({
  isEmbeddingModel: () => true,
  isRerankModel: () => true,
  KnowledgeModelSelect: ({
    value,
    placeholder,
    onChange,
    'aria-label': ariaLabel
  }: {
    value: string | null
    placeholder: string
    onChange: (modelId: string | null) => void
    'aria-label'?: string
  }) => (
    <div>
      <span>{value ?? placeholder}</span>
      <input
        aria-label={ariaLabel ?? placeholder}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      />
    </div>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'common.advanced_settings': '高级设置',
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
          'knowledge.rag.document_count': 'Top K',
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
          'knowledge.rag.search_mode.vector': '向量检索',
          'knowledge.rag.hybrid_alpha': 'Hybrid Alpha',
          'knowledge.rag.hybrid_alpha_hint': '仅在 Hybrid 检索模式下可配置',
          'knowledge.rag.refresh_dimensions': '刷新向量维度',
          'knowledge.rag.rerank_disabled': '不使用',
          'knowledge.rag.rerank_model': '重排模型',
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
  chunkStrategy: 'structured',
  chunkSeparator: '\\n\\n',
  threshold: 0.1,
  documentCount: 6,
  status: 'completed',
  error: null,
  searchMode: 'vector',
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
      }
    })

    mockUseKnowledgeRagConfig.mockReturnValue({
      initialValues: {
        fileProcessorId: null,
        chunkSize: '512',
        chunkOverlap: '64',
        chunkStrategy: 'structured',
        chunkSeparator: '\\n\\n',
        embeddingModelId: 'openai::text-embedding-3-small',
        rerankModelId: null,
        documentCount: 6,
        threshold: 0.1,
        searchMode: 'vector',
        hybridAlpha: null
      },
      fileProcessorOptions: [{ value: 'doc2x', label: 'Doc2X' }],
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
    expect(screen.queryByText('Top K')).not.toBeInTheDocument()
    expect(mockUseKnowledgeRagConfig).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '重建知识库' }))

    expect(onRestoreBase).toHaveBeenCalledWith(expect.objectContaining({ id: 'base-1', status: 'failed' }))
  })

  it('renders current chunk values, hides hybrid alpha outside hybrid mode, and saves through the phase3 hook', async () => {
    renderRagConfigPanel()

    expect(screen.queryByText('separatorRule')).not.toBeInTheDocument()
    expect(screen.queryByText('分隔符规则')).not.toBeInTheDocument()
    expect(screen.getByText('文档处理')).toBeInTheDocument()
    expect(screen.getByText('Top K')).toBeInTheDocument()
    expect(screen.getByText('重排模型')).toBeInTheDocument()
    expect(screen.getByText('不使用')).toBeInTheDocument()
    expect(screen.getByLabelText('嵌入模型')).toHaveValue('openai::text-embedding-3-small')
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

  it('collapses only chunking under an advanced section, keeping the essentials on top', () => {
    renderRagConfigPanel()

    // Advanced section houses the set-and-forget chunking knobs.
    expect(screen.getByRole('button', { name: '高级设置' })).toBeInTheDocument()
    // The advanced fields still render (accordion mock keeps content mounted).
    expect(screen.getByText('分块大小')).toBeInTheDocument()
    // Essentials — including file processing — stay outside the advanced section.
    expect(screen.getByText('文档处理')).toBeInTheDocument()
    expect(screen.getByText('嵌入模型')).toBeInTheDocument()
    expect(screen.getByText('Top K')).toBeInTheDocument()
  })

  it('uses the mini-apps style flat field layout', () => {
    renderRagConfigPanel()

    // Each field label is now a strong text-sm font-medium label (mini-apps FieldLabel parity).
    expect(screen.getByText('文档处理')).toHaveClass('font-medium', 'text-sm')
    expect(screen.getByText('分块大小')).toHaveClass('font-medium', 'text-sm')
    expect(screen.getByText('嵌入模型')).toHaveClass('font-medium', 'text-sm')
    expect(screen.getByText('Top K')).toHaveClass('font-medium', 'text-sm')
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
    expect(screen.getByRole('slider', { name: 'Top K' })).toHaveClass('w-full')
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

  it('opens the rebuild flow when the embedding model changes (itemCount omitted defaults to "not empty")', () => {
    const onRestoreBase = vi.fn()

    renderRagConfigPanel(onRestoreBase)

    fireEvent.change(screen.getByLabelText('嵌入模型'), { target: { value: 'voyage::voyage-3-large' } })
    expect(screen.getByRole('button', { name: '重建' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重建' }))

    expect(mockSave).not.toHaveBeenCalled()
    expect(onRestoreBase).toHaveBeenCalledWith(expect.objectContaining({ id: 'base-1' }), {
      embeddingModelId: 'voyage::voyage-3-large'
    })
  })

  it('keeps the rebuild flow submittable despite invalid chunk fields, since restore ignores the dirty draft', () => {
    const onRestoreBase = vi.fn()

    renderRagConfigPanel(onRestoreBase)

    // Invalidate chunk config first (overlap === size) — the rebuild path must stay
    // submittable through this, since restore only ever reads embeddingModelId off
    // the base and never sends the locally-edited chunk draft.
    fireEvent.change(screen.getByDisplayValue('64'), { target: { value: '512' } })
    fireEvent.change(screen.getByLabelText('嵌入模型'), { target: { value: 'voyage::voyage-3-large' } })

    const rebuildButton = screen.getByRole('button', { name: '重建' })
    expect(rebuildButton).not.toBeDisabled()

    fireEvent.click(rebuildButton)

    expect(mockSave).not.toHaveBeenCalled()
    expect(onRestoreBase).toHaveBeenCalledWith(expect.objectContaining({ id: 'base-1' }), {
      embeddingModelId: 'voyage::voyage-3-large'
    })
  })

  it('opens the rebuild flow when a BM25-only base gains an embedding model', () => {
    const onRestoreBase = vi.fn()

    // Not `mockReturnValueOnce`: the embedding-model change event re-renders the
    // component, which calls this mock again — a `Once` value would be consumed
    // by that re-render and fall back to the module-level hybrid/vector default.
    mockUseKnowledgeRagConfig.mockReturnValue({
      initialValues: {
        fileProcessorId: null,
        chunkSize: '512',
        chunkOverlap: '64',
        chunkStrategy: 'structured',
        chunkSeparator: '\\n\\n',
        embeddingModelId: null,
        rerankModelId: null,
        documentCount: 6,
        threshold: 0.1,
        searchMode: 'bm25',
        hybridAlpha: null
      },
      fileProcessorOptions: [{ value: 'doc2x', label: 'Doc2X' }],
      save: mockSave,
      isLoading: false,
      error: undefined
    })

    renderRagConfigPanel(onRestoreBase, { embeddingModelId: null, dimensions: null, searchMode: 'bm25' })

    // Before picking a model, the search-mode picker only offers bm25.
    expect(screen.queryByRole('button', { name: '向量检索' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('嵌入模型'), { target: { value: 'openai::text-embedding-3-small' } })

    // The picker reacts to the pending form value (not the still-null persisted
    // base), so vector/hybrid become selectable in the same edit that adds a
    // model, instead of only after the restore this triggers completes.
    expect(screen.getByRole('button', { name: '向量检索' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '混合检索（推荐）' })).toBeInTheDocument()

    expect(screen.getByRole('button', { name: '重建' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重建' }))

    expect(mockSave).not.toHaveBeenCalled()
    expect(onRestoreBase).toHaveBeenCalledWith(expect.objectContaining({ id: 'base-1' }), {
      embeddingModelId: 'openai::text-embedding-3-small'
    })
  })

  it('saves the embedding model directly instead of rebuilding when the base has no items', async () => {
    const onRestoreBase = vi.fn()

    renderRagConfigPanel(onRestoreBase, {}, 0)

    fireEvent.change(screen.getByLabelText('嵌入模型'), { target: { value: 'voyage::voyage-3-large' } })
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重建' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ embeddingModelId: 'voyage::voyage-3-large' }), {
        embeddingModelId: 'voyage::voyage-3-large',
        dimensions: 2048
      })
    })
    expect(onRestoreBase).not.toHaveBeenCalled()
    expect(window.toast.success).toHaveBeenCalledWith('已保存')
  })

  it('defaults retrieval mode when an empty BM25-only base gains an embedding model directly', async () => {
    const onRestoreBase = vi.fn()
    mockUseKnowledgeRagConfig.mockReturnValue({
      initialValues: {
        fileProcessorId: null,
        chunkSize: '512',
        chunkOverlap: '64',
        chunkStrategy: 'structured',
        chunkSeparator: '\\n\\n',
        embeddingModelId: null,
        rerankModelId: null,
        documentCount: 6,
        threshold: 0.1,
        searchMode: 'bm25',
        hybridAlpha: null
      },
      fileProcessorOptions: [{ value: 'doc2x', label: 'Doc2X' }],
      save: mockSave,
      isLoading: false,
      error: undefined
    })

    renderRagConfigPanel(onRestoreBase, { embeddingModelId: null, dimensions: null, searchMode: 'bm25' }, 0)

    fireEvent.change(screen.getByLabelText('嵌入模型'), { target: { value: 'openai::text-embedding-3-small' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          embeddingModelId: 'openai::text-embedding-3-small',
          searchMode: 'hybrid',
          hybridAlpha: null
        }),
        {
          embeddingModelId: 'openai::text-embedding-3-small',
          dimensions: 2048
        }
      )
    })
    expect(onRestoreBase).not.toHaveBeenCalled()
  })

  it('shows a dimension-fetch failure toast and does not save when saving the embedding model directly fails', async () => {
    mockEmbedMany.mockRejectedValueOnce(new Error('probe failed'))
    const onRestoreBase = vi.fn()

    renderRagConfigPanel(onRestoreBase, {}, 0)

    fireEvent.change(screen.getByLabelText('嵌入模型'), { target: { value: 'voyage::voyage-3-large' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('获取嵌入维度失败: probe failed')
    })
    expect(mockSave).not.toHaveBeenCalled()
    expect(onRestoreBase).not.toHaveBeenCalled()
  })

  it('keeps the direct-save button disabled when chunk fields are invalid, even after changing the embedding model', () => {
    const onRestoreBase = vi.fn()

    renderRagConfigPanel(onRestoreBase, {}, 0)

    // Invalidate chunk config first (overlap === size), then change the embedding
    // model on the same empty base. Direct save re-submits the whole dirty form
    // (unlike the restore flow, which only ever reads embeddingModelId), so it
    // must stay gated by the same chunk validation as a plain save.
    fireEvent.change(screen.getByDisplayValue('64'), { target: { value: '512' } })
    fireEvent.change(screen.getByLabelText('嵌入模型'), { target: { value: 'voyage::voyage-3-large' } })

    const saveButton = screen.getByRole('button', { name: '保存' })
    expect(saveButton).toBeDisabled()

    fireEvent.click(saveButton)
    expect(mockSave).not.toHaveBeenCalled()
    expect(onRestoreBase).not.toHaveBeenCalled()
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
        chunkStrategy: 'structured',
        chunkSeparator: '\\n\\n',
        embeddingModelId: 'openai::text-embedding-3-small',
        rerankModelId: null,
        documentCount: 6,
        threshold: 0.1,
        searchMode: 'hybrid',
        hybridAlpha: 0.6
      },
      fileProcessorOptions: [{ value: 'doc2x', label: 'Doc2X' }],
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
        chunkStrategy: 'structured',
        chunkSeparator: '\\n\\n',
        embeddingModelId: 'openai::text-embedding-3-small',
        rerankModelId: 'jina::rerank',
        documentCount: 6,
        threshold: 0.1,
        searchMode: 'hybrid',
        hybridAlpha: 0.6
      },
      fileProcessorOptions: [{ value: 'doc2x', label: 'Doc2X' }],
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
