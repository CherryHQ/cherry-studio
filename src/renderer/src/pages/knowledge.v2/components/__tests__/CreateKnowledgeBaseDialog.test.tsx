import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CreateKnowledgeBaseDialog from '../CreateKnowledgeBaseDialog'

const mockUseModels = vi.fn()

vi.mock('@renderer/hooks/useModels', () => ({
  useModels: (...args: unknown[]) => mockUseModels(...args)
}))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...classNames: Array<string | false | null | undefined>) => classNames.filter(Boolean).join(' ')
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{ onValueChange?: (value: string) => void }>({})

  return {
    Button: ({ children, loading, ...props }: { children: ReactNode; loading?: boolean; [key: string]: unknown }) => (
      <button {...props}>{loading ? 'loading' : children}</button>
    ),
    Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
    DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
    FieldError: ({ children }: { children: ReactNode }) => <div role="alert">{children}</div>,
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
    t: (key: string) =>
      (
        ({
          'common.name': '名称',
          'common.cancel': '取消',
          'knowledge_v2.add.title': '新建知识库',
          'knowledge_v2.add.icon': '图标',
          'knowledge_v2.add.submit': '创建',
          'knowledge_v2.embedding_model': '嵌入模型',
          'knowledge_v2.not_set': '未设置',
          'knowledge_v2.name_required': '知识库名称为必填项',
          'knowledge_v2.embedding_model_required': '知识库嵌入模型是必需的',
          'knowledge_v2.error.failed_to_create': '知识库创建失败'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  id: 'base-1',
  name: 'Base 1',
  description: undefined,
  groupId: null,
  emoji: '📁',
  dimensions: 1536,
  embeddingModelId: 'openai::text-embedding-3-small',
  rerankModelId: undefined,
  fileProcessorId: undefined,
  chunkSize: 1024,
  chunkOverlap: 200,
  threshold: undefined,
  documentCount: undefined,
  searchMode: undefined,
  hybridAlpha: undefined,
  createdAt: '2026-04-15T09:00:00+08:00',
  updatedAt: '2026-04-15T09:00:00+08:00',
  ...overrides
})

describe('CreateKnowledgeBaseDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseModels.mockReturnValue({
      models: [{ id: 'openai::text-embedding-3-small' }]
    })
  })

  it('does not submit when the name is empty', async () => {
    const createBase = vi.fn().mockResolvedValue(createKnowledgeBase())

    render(
      <CreateKnowledgeBaseDialog
        open
        isCreating={false}
        createBase={createBase}
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'text-embedding-3-small · openai' }))
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(createBase).not.toHaveBeenCalled())
    expect(screen.getByText('知识库名称为必填项')).toBeInTheDocument()
  })

  it('does not submit when the embedding model is not selected', async () => {
    const createBase = vi.fn().mockResolvedValue(createKnowledgeBase())

    render(
      <CreateKnowledgeBaseDialog
        open
        isCreating={false}
        createBase={createBase}
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'My Base' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(createBase).not.toHaveBeenCalled())
    expect(screen.getByText('知识库嵌入模型是必需的')).toBeInTheDocument()
  })

  it('does not render a manual dimensions input', () => {
    render(
      <CreateKnowledgeBaseDialog
        open
        isCreating={false}
        createBase={vi.fn().mockResolvedValue(createKnowledgeBase())}
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
      />
    )

    expect(screen.queryByLabelText('嵌入维度')).not.toBeInTheDocument()
  })

  it('toggles the selected emoji', () => {
    render(
      <CreateKnowledgeBaseDialog
        open
        isCreating={false}
        createBase={vi.fn().mockResolvedValue(createKnowledgeBase())}
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
      />
    )

    const defaultEmoji = screen.getByRole('button', { name: '📁' })
    const nextEmoji = screen.getByRole('button', { name: '📚' })

    expect(defaultEmoji).toHaveAttribute('aria-pressed', 'true')
    expect(nextEmoji).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(nextEmoji)

    expect(defaultEmoji).toHaveAttribute('aria-pressed', 'false')
    expect(nextEmoji).toHaveAttribute('aria-pressed', 'true')
  })

  it('closes the dialog on cancel without sending a request', () => {
    const createBase = vi.fn().mockResolvedValue(createKnowledgeBase())
    const onOpenChange = vi.fn()

    render(
      <CreateKnowledgeBaseDialog
        open
        isCreating={false}
        createBase={createBase}
        onOpenChange={onOpenChange}
        onCreated={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(createBase).not.toHaveBeenCalled()
  })

  it('submits the selected emoji in the request payload', async () => {
    const createBase = vi.fn().mockResolvedValue(createKnowledgeBase({ emoji: '📚' }))
    const onOpenChange = vi.fn()
    const onCreated = vi.fn()

    render(
      <CreateKnowledgeBaseDialog
        open
        isCreating={false}
        createBase={createBase}
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />
    )

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'My Base' } })
    fireEvent.click(screen.getByRole('button', { name: '📚' }))
    fireEvent.click(screen.getByRole('button', { name: 'text-embedding-3-small · openai' }))
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() =>
      expect(createBase).toHaveBeenCalledWith({
        name: 'My Base',
        emoji: '📚',
        embeddingModelId: 'openai::text-embedding-3-small',
        dimensions: '1536'
      })
    )
    expect(onCreated).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
