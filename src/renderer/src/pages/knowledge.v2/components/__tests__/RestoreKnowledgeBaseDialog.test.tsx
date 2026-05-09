import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RestoreKnowledgeBaseDialog from '../RestoreKnowledgeBaseDialog'

const mockUseModels = vi.fn()

vi.mock('@renderer/hooks/useModels', () => ({
  useModels: (...args: unknown[]) => mockUseModels(...args)
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{ onValueChange?: (value: string) => void }>({})

  return {
    Button: ({ children, loading, ...props }: { children: ReactNode; loading?: boolean; [key: string]: unknown }) => (
      <button {...props}>{loading ? 'loading' : children}</button>
    ),
    Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
    DialogContent: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
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
    t: (key: string, options?: { name?: string }) =>
      (
        ({
          'common.name': '名称',
          'common.cancel': '取消',
          'knowledge_v2.embedding_model': '嵌入模型',
          'knowledge_v2.embedding_model_required': '知识库嵌入模型是必需的',
          'knowledge_v2.name_required': '知识库名称为必填项',
          'knowledge_v2.not_set': '未设置',
          'knowledge_v2.restore.default_name': `${options?.name}_副本`,
          'knowledge_v2.restore.failed_to_restore': '知识库重建失败',
          'knowledge_v2.restore.submit': '重建',
          'knowledge_v2.restore.title': '重建知识库'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  id: 'source-base',
  name: 'Legacy KB',
  groupId: 'group-1',
  emoji: '📁',
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
    Object.assign(window, {
      toast: {
        error: vi.fn()
      }
    })
  })

  it('renders the localized backup name and submits restoreBase with the selected embedding model', async () => {
    const restoredBase = createKnowledgeBase({
      id: 'restored-base',
      name: 'Legacy KB_副本',
      status: 'completed',
      error: null,
      dimensions: 1024,
      embeddingModelId: 'openai::text-embedding-3-small'
    })
    const restoreBase = vi.fn().mockResolvedValue(restoredBase)
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

    expect(screen.getByRole('heading', { name: '重建知识库' })).toHaveClass('text-sm')
    expect(screen.getByLabelText('名称')).toHaveValue('Legacy KB_副本')

    fireEvent.click(screen.getByRole('button', { name: 'text-embedding-3-small · openai' }))
    fireEvent.click(screen.getByRole('button', { name: '重建' }))

    await waitFor(() =>
      expect(restoreBase).toHaveBeenCalledWith({
        sourceBaseId: 'source-base',
        name: 'Legacy KB_副本',
        embeddingModelId: 'openai::text-embedding-3-small',
        dimensions: 1024
      })
    )
    expect(onRestored).toHaveBeenCalledWith(restoredBase)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('does not submit when required fields are missing', async () => {
    const restoreBase = vi.fn().mockResolvedValue(createKnowledgeBase())

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
    expect(screen.getByText('知识库名称为必填项')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Legacy KB_副本' } })
    fireEvent.click(screen.getByRole('button', { name: '重建' }))

    await waitFor(() => expect(restoreBase).not.toHaveBeenCalled())
    expect(screen.getByText('知识库嵌入模型是必需的')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'text-embedding-3-small · openai' }))
    fireEvent.click(screen.getByRole('button', { name: '重建' }))

    await waitFor(() => expect(restoreBase).toHaveBeenCalled())
  })

  it('uses the initial embedding model and dimensions when supplied from the RAG config panel', async () => {
    const restoredBase = createKnowledgeBase({
      id: 'restored-base',
      status: 'completed',
      error: null,
      dimensions: 3072,
      embeddingModelId: 'openai::text-embedding-3-small'
    })
    const restoreBase = vi.fn().mockResolvedValue(restoredBase)

    render(
      <RestoreKnowledgeBaseDialog
        open
        base={createKnowledgeBase({ dimensions: 1024 })}
        initialEmbeddingModelId="openai::text-embedding-3-small"
        initialDimensions={3072}
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
        dimensions: 3072
      })
    )
  })

  it('closes the dialog on cancel without restoring', () => {
    const restoreBase = vi.fn().mockResolvedValue(createKnowledgeBase())
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
})
