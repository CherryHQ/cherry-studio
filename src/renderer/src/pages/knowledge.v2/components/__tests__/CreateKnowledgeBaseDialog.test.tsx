import type { Group } from '@shared/data/types/group'
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
    t: (key: string) =>
      (
        ({
          'common.name': '名称',
          'common.cancel': '取消',
          'knowledge_v2.add.title': '新建知识库',
          'knowledge_v2.add.icon': '图标',
          'knowledge_v2.add.group': '分组',
          'knowledge_v2.add.submit': '创建',
          'knowledge_v2.embedding_model': '嵌入模型',
          'knowledge_v2.not_set': '未设置',
          'knowledge_v2.name_required': '知识库名称为必填项',
          'knowledge_v2.embedding_model_required': '知识库嵌入模型是必需的',
          'knowledge_v2.error.failed_to_create': '知识库创建失败',
          'knowledge_v2.groups.ungrouped': '未分组'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  id: 'base-1',
  name: 'Base 1',
  groupId: null,
  emoji: '📁',
  dimensions: 1024,
  embeddingModelId: 'openai::text-embedding-3-small',
  rerankModelId: undefined,
  fileProcessorId: undefined,
  chunkSize: 1024,
  chunkOverlap: 200,
  threshold: undefined,
  documentCount: undefined,
  status: 'completed',
  error: null,
  searchMode: 'hybrid',
  hybridAlpha: undefined,
  createdAt: '2026-04-15T09:00:00+08:00',
  updatedAt: '2026-04-15T09:00:00+08:00',
  ...overrides
})

const createGroup = (overrides: Partial<Group> = {}): Group => ({
  id: 'group-1',
  entityType: 'knowledge',
  name: 'Research',
  orderKey: 'a0',
  createdAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-23T00:00:00.000Z',
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
        groups={[]}
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
        groups={[]}
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
        groups={[]}
        isCreating={false}
        createBase={vi.fn().mockResolvedValue(createKnowledgeBase())}
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
      />
    )

    expect(screen.queryByLabelText('嵌入维度')).not.toBeInTheDocument()
  })

  it('applies compact sizing to the fields and actions', () => {
    render(
      <CreateKnowledgeBaseDialog
        open
        groups={[]}
        isCreating={false}
        createBase={vi.fn().mockResolvedValue(createKnowledgeBase())}
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
      />
    )

    expect(screen.getByRole('heading', { name: '新建知识库' })).toHaveClass('leading-4')
    expect(screen.getByText('名称')).toHaveClass('leading-4')
    expect(screen.getByLabelText('名称')).toHaveClass('h-8')
    expect(screen.queryByText('分组')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '未设置' })).toHaveClass('h-8')
    expect(screen.getByRole('button', { name: '取消' })).toHaveClass('h-8')
    expect(screen.getByRole('button', { name: '创建' })).toHaveClass('h-8')
  })

  it('toggles the selected emoji', () => {
    render(
      <CreateKnowledgeBaseDialog
        open
        groups={[]}
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
        groups={[]}
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

  it('hides the group field when there are no real groups', () => {
    render(
      <CreateKnowledgeBaseDialog
        open
        groups={[]}
        isCreating={false}
        createBase={vi.fn().mockResolvedValue(createKnowledgeBase())}
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
      />
    )

    expect(screen.queryByText('分组')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '未分组' })).not.toBeInTheDocument()
  })

  it('renders real group options without an ungrouped option', () => {
    render(
      <CreateKnowledgeBaseDialog
        open
        groups={[createGroup(), createGroup({ id: 'group-2', name: 'Archive', orderKey: 'a1' })]}
        isCreating={false}
        createBase={vi.fn().mockResolvedValue(createKnowledgeBase())}
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
      />
    )

    expect(screen.getByText('分组')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '未分组' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Research' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument()
  })

  it('ignores a stale initial group id when there are no real groups', async () => {
    const createBase = vi.fn().mockResolvedValue(createKnowledgeBase())

    render(
      <CreateKnowledgeBaseDialog
        open
        groups={[]}
        initialGroupId="deleted-group"
        isCreating={false}
        createBase={createBase}
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'My Base' } })
    fireEvent.click(screen.getByRole('button', { name: 'text-embedding-3-small · openai' }))
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() =>
      expect(createBase).toHaveBeenCalledWith({
        name: 'My Base',
        emoji: '📁',
        embeddingModelId: 'openai::text-embedding-3-small',
        dimensions: 1024
      })
    )
  })

  it('submits the selected emoji in the request payload', async () => {
    const createBase = vi.fn().mockResolvedValue(createKnowledgeBase({ emoji: '📚' }))
    const onOpenChange = vi.fn()
    const onCreated = vi.fn()

    render(
      <CreateKnowledgeBaseDialog
        open
        groups={[createGroup()]}
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
        dimensions: 1024
      })
    )
    expect(onCreated).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows submit error and keeps the dialog open when createBase rejects', async () => {
    const createBase = vi.fn().mockRejectedValue(new Error('create failed'))
    const onOpenChange = vi.fn()
    const onCreated = vi.fn()

    render(
      <CreateKnowledgeBaseDialog
        open
        groups={[]}
        isCreating={false}
        createBase={createBase}
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />
    )

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'My Base' } })
    fireEvent.click(screen.getByRole('button', { name: 'text-embedding-3-small · openai' }))
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('知识库创建失败: create failed'))
    expect(onCreated).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('submits the selected group id in the request payload', async () => {
    const createBase = vi.fn().mockResolvedValue(createKnowledgeBase({ groupId: 'group-2' }))

    render(
      <CreateKnowledgeBaseDialog
        open
        groups={[createGroup(), createGroup({ id: 'group-2', name: 'Archive', orderKey: 'a1' })]}
        isCreating={false}
        createBase={createBase}
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'My Base' } })
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    fireEvent.click(screen.getByRole('button', { name: 'text-embedding-3-small · openai' }))
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() =>
      expect(createBase).toHaveBeenCalledWith({
        name: 'My Base',
        emoji: '📁',
        groupId: 'group-2',
        embeddingModelId: 'openai::text-embedding-3-small',
        dimensions: 1024
      })
    )
  })

  it('submits the initial group id in the request payload', async () => {
    const createBase = vi.fn().mockResolvedValue(createKnowledgeBase({ groupId: 'group-2' }))

    render(
      <CreateKnowledgeBaseDialog
        open
        groups={[createGroup(), createGroup({ id: 'group-2', name: 'Archive', orderKey: 'a1' })]}
        initialGroupId="group-2"
        isCreating={false}
        createBase={createBase}
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'My Base' } })
    fireEvent.click(screen.getByRole('button', { name: 'text-embedding-3-small · openai' }))
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() =>
      expect(createBase).toHaveBeenCalledWith({
        name: 'My Base',
        emoji: '📁',
        groupId: 'group-2',
        embeddingModelId: 'openai::text-embedding-3-small',
        dimensions: 1024
      })
    )
  })
})
