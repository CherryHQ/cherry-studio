import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RestoreKnowledgeBaseDialog from '../RestoreKnowledgeBaseDialog'

const mockUseModels = vi.fn()
const mockUseProviders = vi.fn()
const mockEmbedMany = vi.fn()

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: (...args: unknown[]) => mockUseModels(...args)
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: (...args: unknown[]) => mockUseProviders(...args)
}))

vi.mock('../KnowledgeModelSelect', () => ({
  isEmbeddingModel: () => true,
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
    <input
      aria-label={ariaLabel ?? placeholder}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
    />
  )
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{ onValueChange?: (value: string) => void }>({})

  return {
    Button: ({ children, loading, ...props }: { children: ReactNode; loading?: boolean; [key: string]: unknown }) => (
      <button {...props}>{loading ? 'loading' : children}</button>
    ),
    Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
    DialogContent: ({ children, size, ...props }: { children: ReactNode; size?: string; [key: string]: unknown }) => (
      <div role="dialog" data-size={size} {...props}>
        {children}
      </div>
    ),
    DialogDescription: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <p {...props}>{children}</p>
    ),
    DialogFooter: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
    DialogHeader: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
    DialogTitle: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <h1 {...props}>{children}</h1>
    ),
    FieldError: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <div role="alert" {...props}>
        {children}
      </div>
    ),
    Input: (props: Record<string, unknown>) => <input {...props} />,
    Label: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <label {...props}>{children}</label>
    ),
    Select: ({
      children,
      onValueChange
    }: {
      children: ReactNode
      onValueChange?: (value: string) => void
      value?: string
    }) => <SelectContext value={{ onValueChange }}>{children}</SelectContext>,
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: ReactNode; value: string }) => {
      const { onValueChange } = React.use(SelectContext)
      return (
        <button type="button" onClick={() => onValueChange?.(value)}>
          {children}
        </button>
      )
    },
    SelectTrigger: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string; count?: number }) =>
      (
        ({
          'common.name': '名称',
          'common.cancel': '取消',
          'knowledge.embedding_model': '嵌入模型',
          'knowledge.error.missing_embedding_model':
            '迁移时未找到原知识库使用的嵌入模型，请重建知识库并选择新的嵌入模型。',
          'knowledge.embedding_model_required': '知识库嵌入模型是必需的',
          'knowledge.dimensions': '嵌入维度',
          'knowledge.dimensions_error_invalid': '无效的嵌入维度',
          'knowledge.name_required': '知识库名称为必填项',
          'knowledge.not_set': '未设置',
          'knowledge.restore.default_name': `${options?.name}_副本`,
          'knowledge.restore.skipped_missing_sources': `已跳过 ${options?.count} 个源已丢失的项目`,
          'knowledge.restore.failed_to_restore': '知识库重建失败',
          'knowledge.restore.submit': '重建',
          'knowledge.restore.title': '重建知识库',
          'message.error.get_embedding_dimensions': '获取嵌入维度失败'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

Object.assign(window, {
  api: {
    ...(window as typeof window & { api?: { ai?: Record<string, unknown> } }).api,
    ai: {
      ...(window as typeof window & { api?: { ai?: Record<string, unknown> } }).api?.ai,
      embedMany: mockEmbedMany
    }
  }
})

const createKnowledgeBase = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  id: 'source-base',
  name: 'Legacy KB',
  groupId: 'group-1',
  dimensions: null,
  embeddingModelId: null,
  rerankModelId: undefined,
  fileProcessorId: undefined,
  chunkSize: 1024,
  chunkOverlap: 200,
  threshold: undefined,
  documentCount: undefined,
  status: 'failed',
  error: 'missing_embedding_model',
  searchMode: 'hybrid',
  hybridAlpha: undefined,
  createdAt: '2026-04-15T09:00:00+08:00',
  updatedAt: '2026-04-15T09:00:00+08:00',
  ...overrides
})

describe('RestoreKnowledgeBaseDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseModels.mockReturnValue({
      models: [{ id: 'openai::text-embedding-3-small' }]
    })
    mockUseProviders.mockReturnValue({
      providers: [{ id: 'openai', isEnabled: true }]
    })
    mockEmbedMany.mockResolvedValue({ embeddings: [new Array(1536).fill(0)] })
    Object.assign(window, {
      toast: {
        error: vi.fn(),
        warning: vi.fn()
      }
    })
  })

  it('renders the localized backup name and submits restoreBase with the selected embedding model', async () => {
    const restoredBase = createKnowledgeBase({
      id: 'restored-base',
      name: 'Legacy KB_副本',
      status: 'completed',
      error: null,
      dimensions: 1536,
      embeddingModelId: 'openai::text-embedding-3-small'
    })
    const restoreBase = vi.fn().mockResolvedValue({ base: restoredBase, skippedMissingSourceCount: 0 })
    const onOpenChange = vi.fn()
    const onRestored = vi.fn()

    render(
      <RestoreKnowledgeBaseDialog
        open
        base={createKnowledgeBase()}
        isRestoring={false}
        restoreBase={restoreBase}
        onOpenChange={onOpenChange}
        onRestored={onRestored}
      />
    )

    expect(screen.getByRole('heading', { name: '重建知识库' })).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveAttribute('data-size', 'lg')
    expect(screen.getByLabelText('名称')).toHaveValue('Legacy KB_副本')

    fireEvent.change(screen.getByLabelText('嵌入模型'), { target: { value: 'openai::text-embedding-3-small' } })
    fireEvent.click(screen.getByRole('button', { name: '重建' }))

    await waitFor(() =>
      expect(restoreBase).toHaveBeenCalledWith({
        sourceBaseId: 'source-base',
        name: 'Legacy KB_副本',
        embeddingModelId: 'openai::text-embedding-3-small',
        dimensions: 1536
      })
    )
    expect(mockEmbedMany).toHaveBeenCalledWith({
      uniqueModelId: 'openai::text-embedding-3-small',
      values: ['test']
    })
    expect(onRestored).toHaveBeenCalledWith(restoredBase)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    // Nothing was skipped, so the user is not warned.
    expect(window.toast.warning).not.toHaveBeenCalled()
  })

  it('warns the user when restore skipped items whose source is gone', async () => {
    const restoredBase = createKnowledgeBase({
      id: 'restored-base',
      status: 'completed',
      error: null,
      dimensions: 1536,
      embeddingModelId: 'openai::text-embedding-3-small'
    })
    const restoreBase = vi.fn().mockResolvedValue({ base: restoredBase, skippedMissingSourceCount: 2 })
    const onRestored = vi.fn()

    render(
      <RestoreKnowledgeBaseDialog
        open
        base={createKnowledgeBase()}
        isRestoring={false}
        restoreBase={restoreBase}
        onOpenChange={vi.fn()}
        onRestored={onRestored}
      />
    )

    fireEvent.change(screen.getByLabelText('嵌入模型'), { target: { value: 'openai::text-embedding-3-small' } })
    fireEvent.click(screen.getByRole('button', { name: '重建' }))

    await waitFor(() => expect(restoreBase).toHaveBeenCalled())
    // The skipped count is surfaced via a warning toast (not silently dropped); the base still restores.
    expect(window.toast.warning).toHaveBeenCalledTimes(1)
    expect(window.toast.warning).toHaveBeenCalledWith(expect.stringContaining('2'))
    expect(onRestored).toHaveBeenCalledWith(restoredBase)
  })

  it('does not submit when required fields are missing', async () => {
    const restoreBase = vi.fn().mockResolvedValue({ base: createKnowledgeBase(), skippedMissingSourceCount: 0 })

    render(
      <RestoreKnowledgeBaseDialog
        open
        base={createKnowledgeBase()}
        isRestoring={false}
        restoreBase={restoreBase}
        onOpenChange={vi.fn()}
        onRestored={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: '重建' }))

    await waitFor(() => expect(restoreBase).not.toHaveBeenCalled())
    expect(mockEmbedMany).not.toHaveBeenCalled()
    expect(screen.getByText('知识库名称为必填项')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Legacy KB_副本' } })
    fireEvent.click(screen.getByRole('button', { name: '重建' }))

    await waitFor(() => expect(restoreBase).not.toHaveBeenCalled())
    expect(mockEmbedMany).not.toHaveBeenCalled()
    expect(screen.getByText('知识库嵌入模型是必需的')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('嵌入模型'), { target: { value: 'openai::text-embedding-3-small' } })
    fireEvent.click(screen.getByRole('button', { name: '重建' }))

    await waitFor(() => expect(restoreBase).toHaveBeenCalled())
  })

  it('probes dimensions when the RAG config panel supplies a new embedding model without dimensions', async () => {
    mockEmbedMany.mockResolvedValueOnce({ embeddings: [new Array(2048).fill(0)] })
    const restoredBase = createKnowledgeBase({
      id: 'restored-base',
      status: 'completed',
      error: null,
      dimensions: 2048,
      embeddingModelId: 'openai::text-embedding-3-small'
    })
    const restoreBase = vi.fn().mockResolvedValue({ base: restoredBase, skippedMissingSourceCount: 0 })

    render(
      <RestoreKnowledgeBaseDialog
        open
        base={createKnowledgeBase({ dimensions: 1024 })}
        initialEmbeddingModelId="openai::text-embedding-3-small"
        isRestoring={false}
        restoreBase={restoreBase}
        onOpenChange={vi.fn()}
        onRestored={vi.fn()}
      />
    )

    expect(screen.queryByLabelText('嵌入维度')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重建' }))

    await waitFor(() =>
      expect(restoreBase).toHaveBeenCalledWith({
        sourceBaseId: 'source-base',
        name: 'Legacy KB_副本',
        embeddingModelId: 'openai::text-embedding-3-small',
        dimensions: 2048
      })
    )
    expect(mockEmbedMany).toHaveBeenCalledWith({
      uniqueModelId: 'openai::text-embedding-3-small',
      values: ['test']
    })
  })

  it('shows submit error and keeps the dialog open when restoreBase rejects', async () => {
    const restoreBase = vi.fn().mockRejectedValue(new Error('restore failed'))
    const onOpenChange = vi.fn()
    const onRestored = vi.fn()

    render(
      <RestoreKnowledgeBaseDialog
        open
        base={createKnowledgeBase()}
        isRestoring={false}
        restoreBase={restoreBase}
        onOpenChange={onOpenChange}
        onRestored={onRestored}
      />
    )

    fireEvent.change(screen.getByLabelText('嵌入模型'), { target: { value: 'openai::text-embedding-3-small' } })
    fireEvent.click(screen.getByRole('button', { name: '重建' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('知识库重建失败: restore failed'))
    expect(onRestored).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('shows an error and keeps the dialog open when embedding dimensions cannot be fetched', async () => {
    mockEmbedMany.mockRejectedValueOnce(new Error('probe failed'))
    const restoreBase = vi.fn().mockResolvedValue({ base: createKnowledgeBase(), skippedMissingSourceCount: 0 })
    const onOpenChange = vi.fn()
    const onRestored = vi.fn()

    render(
      <RestoreKnowledgeBaseDialog
        open
        base={createKnowledgeBase()}
        isRestoring={false}
        restoreBase={restoreBase}
        onOpenChange={onOpenChange}
        onRestored={onRestored}
      />
    )

    fireEvent.change(screen.getByLabelText('嵌入模型'), { target: { value: 'openai::text-embedding-3-small' } })
    fireEvent.click(screen.getByRole('button', { name: '重建' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('获取嵌入维度失败: probe failed'))
    expect(screen.queryByLabelText('嵌入维度')).not.toBeInTheDocument()
    expect(restoreBase).not.toHaveBeenCalled()
    expect(onRestored).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('closes the dialog on cancel without restoring', () => {
    const restoreBase = vi.fn().mockResolvedValue({ base: createKnowledgeBase(), skippedMissingSourceCount: 0 })
    const onOpenChange = vi.fn()

    render(
      <RestoreKnowledgeBaseDialog
        open
        base={createKnowledgeBase()}
        isRestoring={false}
        restoreBase={restoreBase}
        onOpenChange={onOpenChange}
        onRestored={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(restoreBase).not.toHaveBeenCalled()
  })

  it('explains why the base failed so the user knows what they are rebuilding', () => {
    render(
      <RestoreKnowledgeBaseDialog
        open
        base={createKnowledgeBase({ status: 'failed', error: 'missing_embedding_model' })}
        isRestoring={false}
        restoreBase={vi.fn()}
        onOpenChange={vi.fn()}
        onRestored={vi.fn()}
      />
    )

    expect(screen.getByText('迁移时未找到原知识库使用的嵌入模型，请重建知识库并选择新的嵌入模型。')).toBeInTheDocument()
  })

  it('omits the failure reason for a healthy base', () => {
    render(
      <RestoreKnowledgeBaseDialog
        open
        base={createKnowledgeBase({ status: 'completed', error: null })}
        isRestoring={false}
        restoreBase={vi.fn()}
        onOpenChange={vi.fn()}
        onRestored={vi.fn()}
      />
    )

    expect(
      screen.queryByText('迁移时未找到原知识库使用的嵌入模型，请重建知识库并选择新的嵌入模型。')
    ).not.toBeInTheDocument()
  })
})
