import type { Group } from '@shared/data/types/group'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CreateKnowledgeBaseDialog from '../CreateKnowledgeBaseDialog'

const mockIpcRequest = vi.fn()
const mockSettingsNavigate = vi.fn()

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (...args: unknown[]) => mockIpcRequest(...args)
  }
}))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...classNames: Array<string | false | null | undefined>) => classNames.filter(Boolean).join(' ')
}))

vi.mock('../KnowledgeEmbeddingModelSelect', () => ({
  KnowledgeEmbeddingModelSelect: ({
    value,
    placeholder,
    noneOptionLabel,
    onChange,
    onSettingsNavigate,
    'aria-label': ariaLabel
  }: {
    value: string | null
    placeholder: string
    noneOptionLabel?: string
    onChange: (modelId: string | null) => void
    onSettingsNavigate?: (navigate: () => void) => void
    'aria-label'?: string
  }) => (
    <>
      <input
        aria-label={ariaLabel ?? placeholder}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      />
      <button type="button" onClick={() => onSettingsNavigate?.(mockSettingsNavigate)}>
        open model settings
      </button>
      <button type="button" onClick={() => onChange('local-embedding::qwen3-embedding-0.6b')}>
        local-model-option
      </button>
      {noneOptionLabel ? (
        <button type="button" onClick={() => onChange(null)}>
          {noneOptionLabel}
        </button>
      ) : null}
    </>
  )
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{ onValueChange?: (value: string) => void }>({})

  return {
    Button: ({ children, loading, ...props }: { children: ReactNode; loading?: boolean; [key: string]: unknown }) => (
      <button type="button" {...props}>
        {loading ? 'loading' : children}
      </button>
    ),
    Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
    DialogContent: ({
      children,
      closeOnOverlayClick,
      size,
      ...props
    }: {
      children: ReactNode
      closeOnOverlayClick?: boolean
      size?: string
      [key: string]: unknown
    }) => {
      void closeOnOverlayClick
      return (
        <div role="dialog" data-size={size} {...props}>
          {children}
        </div>
      )
    },
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
          'common.clear': '清除',
          'knowledge.add.title': '新建知识库',
          'knowledge.add.group': '分组',
          'knowledge.add.submit': '创建',
          'knowledge.embedding_model': '嵌入模型',
          'knowledge.not_set': '未设置',
          'knowledge.name_required': '知识库名称为必填项',
          'knowledge.error.failed_to_create': '知识库创建失败',
          'knowledge.groups.default': '默认',
          'message.error.get_embedding_dimensions': '获取嵌入维度失败'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  id: 'base-1',
  name: 'Base 1',
  groupId: null,
  dimensions: null,
  embeddingModelId: null,
  rerankModelId: undefined,
  fileProcessorId: undefined,
  chunkSize: 1024,
  chunkOverlap: 200,
  chunkStrategy: 'structured',
  chunkSeparator: '\\n\\n',
  documentCount: undefined,
  status: 'completed',
  error: null,
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
    // The embedding dimensions probe goes through ipcApi.request('ai.embedding.embed_many', …).
    mockIpcRequest.mockResolvedValue({ embeddings: [new Array(1536).fill(0)] })
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

    expect(screen.getByRole('dialog')).toHaveAttribute('data-size', 'sm')
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(createBase).not.toHaveBeenCalled())
    expect(screen.getByText('知识库名称为必填项')).toBeInTheDocument()
  })

  it('renders the embedding model field as optional', () => {
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

    expect(screen.getByText('嵌入模型')).toBeInTheDocument()
    expect(screen.getByLabelText('嵌入模型')).toHaveValue('')
  })

  it('renders all required fields and actions when a knowledge base is being created', () => {
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

    expect(screen.getByRole('heading', { name: '新建知识库' })).toBeInTheDocument()
    expect(screen.getByText('名称')).toBeInTheDocument()
    expect(screen.getByLabelText('名称')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('名称')).toBeInTheDocument()
    expect(screen.queryByText('分组')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建' })).toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: '默认' })).not.toBeInTheDocument()
  })

  it('renders the default group as a selectable option alongside the real groups', () => {
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
    // The trigger renders the default label and the list now offers an explicit default option.
    expect(screen.getAllByRole('button', { name: '默认' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Research' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument()
  })

  it('submits without a group id when the default group option is selected', async () => {
    const createBase = vi.fn().mockResolvedValue(createKnowledgeBase())

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
    // Switch the preselected group back to the default group via the explicit option (last "默认" button is the item).
    const defaultOptions = screen.getAllByRole('button', { name: '默认' })
    fireEvent.click(defaultOptions[defaultOptions.length - 1])
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(createBase).toHaveBeenCalledWith({ name: 'My Base' }))
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
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(createBase).toHaveBeenCalledWith({ name: 'My Base' }))
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
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(createBase).toHaveBeenCalledWith({ name: 'My Base', groupId: 'group-2' }))
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
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(createBase).toHaveBeenCalledWith({ name: 'My Base', groupId: 'group-2' }))
  })

  it('creates a BM25-only base without probing dimensions after clearing a picked embedding model', async () => {
    const user = userEvent.setup()
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
    fireEvent.change(screen.getByLabelText('嵌入模型'), { target: { value: 'openai::text-embedding-3-small' } })
    await user.click(screen.getByRole('button', { name: '未设置' }))
    await user.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(createBase).toHaveBeenCalledWith({ name: 'My Base' }))
    expect(mockIpcRequest).not.toHaveBeenCalled()
  })

  it('submits the picked embedding model together with its probed dimensions', async () => {
    const createBase = vi
      .fn()
      .mockResolvedValue(createKnowledgeBase({ embeddingModelId: 'openai::text-embedding-3-small', dimensions: 1536 }))

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
    fireEvent.change(screen.getByLabelText('嵌入模型'), { target: { value: 'openai::text-embedding-3-small' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() =>
      expect(createBase).toHaveBeenCalledWith({
        name: 'My Base',
        embeddingModelId: 'openai::text-embedding-3-small',
        dimensions: 1536
      })
    )
    expect(mockIpcRequest).toHaveBeenCalledWith('ai.embedding.embed_many', {
      uniqueModelId: 'openai::text-embedding-3-small',
      values: ['test']
    })
  })

  it('keeps the local embedding entry inside the model selector', () => {
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

    expect(screen.getByRole('button', { name: 'local-model-option' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('嵌入模型'), { target: { value: 'openai::text-embedding-3-small' } })

    expect(screen.getByRole('button', { name: 'local-model-option' })).toBeInTheDocument()
  })

  it('submits the local embedding model with its fixed dimensions and no probe', async () => {
    const createBase = vi.fn().mockResolvedValue(
      createKnowledgeBase({
        embeddingModelId: 'local-embedding::qwen3-embedding-0.6b',
        dimensions: 1024
      })
    )

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
    fireEvent.click(screen.getByRole('button', { name: 'local-model-option' }))
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() =>
      expect(createBase).toHaveBeenCalledWith({
        name: 'My Base',
        embeddingModelId: 'local-embedding::qwen3-embedding-0.6b',
        dimensions: 1024
      })
    )
    // The local model runs in-process with a known dimension, so it is never probed.
    expect(mockIpcRequest).not.toHaveBeenCalled()
  })

  it('keeps the dialog open and reports the error when probing dimensions fails', async () => {
    const createBase = vi.fn().mockResolvedValue(createKnowledgeBase())
    const onOpenChange = vi.fn()
    mockIpcRequest.mockRejectedValue(new Error('probe failed'))

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

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'My Base' } })
    fireEvent.change(screen.getByLabelText('嵌入模型'), { target: { value: 'openai::text-embedding-3-small' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('获取嵌入维度失败: probe failed'))
    expect(createBase).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('closes the dialog before navigating to the model settings', () => {
    const onOpenChange = vi.fn()

    render(
      <CreateKnowledgeBaseDialog
        open
        groups={[]}
        isCreating={false}
        createBase={vi.fn().mockResolvedValue(createKnowledgeBase())}
        onOpenChange={onOpenChange}
        onCreated={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'open model settings' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
