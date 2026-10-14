import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DataApiErrorFactory } from '@shared/data/api/errors'

import { PromptSettings } from '../PromptSettings'

const prompts = [
  {
    id: '018f8f16-3540-7cc2-b3cc-11ef1e3f35ac',
    title: 'Global prompt',
    content: 'Available everywhere',
    visibility: 'global' as const,
    orderKey: 'a0',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z'
  },
  {
    id: '018f8f16-3540-7cc2-b3cc-11ef1e3f35ad',
    title: 'Targeted prompt',
    content: 'Available when linked',
    visibility: 'restricted' as const,
    orderKey: 'a1',
    createdAt: '2026-05-02T00:00:00.000Z',
    updatedAt: '2026-05-02T00:00:00.000Z'
  },
  {
    id: '018f8f16-3540-7cc2-b3cc-11ef1e3f35ae',
    title: 'Second targeted prompt',
    content: 'Available when linked elsewhere',
    visibility: 'restricted' as const,
    orderKey: 'a2',
    createdAt: '2026-05-03T00:00:00.000Z',
    updatedAt: '2026-05-03T00:00:00.000Z'
  }
]

const promptBindings = [
  {
    promptId: prompts[1].id,
    targetType: 'assistant',
    targetId: 'assistant-1'
  },
  {
    promptId: prompts[1].id,
    targetType: 'agent',
    targetId: 'agent-1'
  }
]

const mocks = vi.hoisted(() => ({
  applyReorderedList: vi.fn(),
  createPrompt: vi.fn(),
  deletePrompt: vi.fn(),
  refetch: vi.fn(),
  refetchBindings: vi.fn(),
  updatePrompt: vi.fn(),
  useQuery: vi.fn()
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useDataChange: vi.fn(),
  useQuery: (...args: unknown[]) => mocks.useQuery(...args)
}))

vi.mock('@data/hooks/useReorder', () => ({
  useReorder: () => ({ applyReorderedList: mocks.applyReorderedList, isPending: false })
}))

vi.mock('@renderer/hooks/resourceCatalog', () => ({
  agentAdapter: {
    useList: () => ({ data: [], error: undefined, isLoading: false, refetch: vi.fn() })
  },
  assistantAdapter: {
    useList: () => ({ data: [], error: undefined, isLoading: false, refetch: vi.fn() })
  },
  usePromptMutations: () => ({ createPrompt: mocks.createPrompt }),
  usePromptMutationsById: () => ({ deletePrompt: mocks.deletePrompt, updatePrompt: mocks.updatePrompt })
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/edit', () => ({
  PromptEditDialog: ({
    onSave,
    open,
    prompt
  }: {
    onSave: (value: { title: string; content: string; visibility: 'global' | 'restricted' }) => Promise<void>
    open: boolean
    prompt?: (typeof prompts)[number] | null
  }) =>
    open ? (
      <div data-testid="prompt-edit-dialog">
        <span>{prompt ? `edit:${prompt.title}` : 'create'}</span>
        <button
          type="button"
          onClick={() =>
            void onSave({ title: 'Saved title', content: 'Saved content', visibility: prompt?.visibility ?? 'global' })
          }>
          save prompt
        </button>
        <button
          type="button"
          onClick={() => void onSave({ title: 'Saved title', content: 'Saved content', visibility: 'global' })}>
          save global prompt
        </button>
      </div>
    ) : null
}))

vi.mock('../PromptTargetPopover', () => ({
  PromptTargetPopover: () => null
}))

vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn() } }))
vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (_error: unknown, prefix: string) => prefix
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key}:${options.count}`)
  })
}))

vi.mock('@cherrystudio/ui', () => ({
  Alert: ({ message }: { message: ReactNode }) => <div role="alert">{message}</div>,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    loading,
    size,
    variant,
    ...props
  }: ComponentProps<'button'> & { loading?: boolean; size?: string; variant?: string }) => {
    void loading
    void size
    void variant
    return (
      <button type="button" {...props}>
        {children}
      </button>
    )
  },
  ConfirmDialog: ({
    cancelText,
    confirmText,
    description,
    onConfirm,
    onOpenChange,
    open,
    title
  }: {
    cancelText: string
    confirmText: string
    description: ReactNode
    onConfirm: () => Promise<void>
    onOpenChange: (open: boolean) => void
    open: boolean
    title: string
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <span>{description}</span>
        <button type="button" onClick={() => void onConfirm().catch(() => undefined)}>
          {confirmText}
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          {cancelText}
        </button>
      </div>
    ) : null,
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
    variant,
    ...props
  }: {
    children: ReactNode
    onSelect?: () => void
    variant?: string
    'aria-label'?: string
  }) => {
    void variant
    return (
      <button type="button" onClick={onSelect} {...props}>
        {children}
      </button>
    )
  },
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  EmojiIcon: ({ emoji }: { emoji: string }) => <span>{emoji}</span>,
  EmptyState: ({ title }: { title: ReactNode }) => <div>{title}</div>,
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
  ReorderableList: ({
    items,
    renderItem
  }: {
    items: typeof prompts
    renderItem: (prompt: (typeof prompts)[number], index: number, state: { dragHandleProps?: undefined }) => ReactNode
  }) => (
    <div>
      {items.map((prompt, index) => (
        <div key={prompt.id}>{renderItem(prompt, index, {})}</div>
      ))}
    </div>
  ),
  Scrollbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Skeleton: (props: ComponentProps<'div'>) => <div {...props} />,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useQuery.mockImplementation((path: string) => {
    if (path === '/prompts') {
      return { data: prompts, error: undefined, isLoading: false, refetch: mocks.refetch }
    }
    if (path === '/prompt-bindings') {
      return { data: promptBindings, error: undefined, isLoading: false, refetch: mocks.refetchBindings }
    }
    return {
      data: [],
      error: undefined,
      isLoading: false,
      refetch: mocks.refetchBindings
    }
  })
  mocks.createPrompt.mockResolvedValue(prompts[0])
  mocks.updatePrompt.mockResolvedValue(prompts[0])
  mocks.deletePrompt.mockResolvedValue(undefined)
  mocks.refetchBindings.mockResolvedValue([])
})

describe('PromptSettings', () => {
  it('lists global and restricted prompts from the settings route', () => {
    render(<PromptSettings />)

    expect(mocks.useQuery).toHaveBeenCalledWith('/prompts', {})
    expect(screen.getByText('Global prompt')).toBeInTheDocument()
    expect(screen.getByText('Targeted prompt')).toBeInTheDocument()
    expect(screen.getByText('settings.prompts.visibility.global.badge')).toBeInTheDocument()
    expect(screen.queryByText('settings.prompts.visibility.restricted.badge')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.search' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.edit Global prompt' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.delete Global prompt' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Global prompt' })).not.toBeInTheDocument()
  })

  it('creates a prompt with its selected visibility', async () => {
    const user = userEvent.setup()
    render(<PromptSettings />)

    await user.click(screen.getByRole('button', { name: 'settings.prompts.add' }))
    expect(screen.getByTestId('prompt-edit-dialog')).toHaveTextContent('create')
    await user.click(screen.getByRole('button', { name: 'save prompt' }))

    await waitFor(() =>
      expect(mocks.createPrompt).toHaveBeenCalledWith({
        title: 'Saved title',
        content: 'Saved content',
        visibility: 'global'
      })
    )
  })

  it('requires confirmation before making a linked restricted prompt global', async () => {
    const user = userEvent.setup()
    const bindings = [
      { type: 'assistant' as const, id: '11111111-1111-4111-8111-111111111111' },
      { type: 'agent' as const, id: 'agent-1' }
    ]
    mocks.refetchBindings.mockResolvedValue(bindings)
    render(<PromptSettings />)

    await user.click(screen.getByRole('button', { name: 'common.edit Targeted prompt' }))
    await user.click(screen.getByRole('button', { name: 'save global prompt' }))

    const confirmDialog = await screen.findByRole('dialog', {
      name: 'settings.prompts.visibility.makeGlobalConfirmTitle'
    })
    expect(confirmDialog).toHaveTextContent('settings.prompts.visibility.makeGlobalConfirmDescription:2')
    expect(mocks.updatePrompt).not.toHaveBeenCalled()

    await user.click(within(confirmDialog).getByRole('button', { name: 'common.confirm' }))

    await waitFor(() =>
      expect(mocks.updatePrompt).toHaveBeenCalledWith({
        title: 'Saved title',
        content: 'Saved content',
        visibility: 'global',
        expectedBindings: bindings
      })
    )
  })

  it('refreshes a stale binding snapshot and requires confirmation again', async () => {
    const user = userEvent.setup()
    const originalBindings = [{ type: 'agent' as const, id: 'agent-old' }]
    const replacementBindings = [{ type: 'agent' as const, id: 'agent-new' }]
    mocks.refetchBindings.mockResolvedValueOnce(originalBindings).mockResolvedValueOnce(replacementBindings)
    mocks.updatePrompt
      .mockRejectedValueOnce(DataApiErrorFactory.concurrentModification('Prompt bindings', prompts[1].id))
      .mockResolvedValueOnce(prompts[0])
    render(<PromptSettings />)

    await user.click(screen.getByRole('button', { name: 'common.edit Targeted prompt' }))
    await user.click(screen.getByRole('button', { name: 'save global prompt' }))
    const confirmDialog = await screen.findByRole('dialog', {
      name: 'settings.prompts.visibility.makeGlobalConfirmTitle'
    })

    await user.click(within(confirmDialog).getByRole('button', { name: 'common.confirm' }))
    await waitFor(() => expect(mocks.refetchBindings).toHaveBeenCalledTimes(2))
    expect(mocks.updatePrompt).toHaveBeenNthCalledWith(1, {
      title: 'Saved title',
      content: 'Saved content',
      visibility: 'global',
      expectedBindings: originalBindings
    })
    expect(screen.getByRole('dialog', { name: 'settings.prompts.visibility.makeGlobalConfirmTitle' })).toBeVisible()

    await user.click(within(confirmDialog).getByRole('button', { name: 'common.confirm' }))
    await waitFor(() =>
      expect(mocks.updatePrompt).toHaveBeenNthCalledWith(2, {
        title: 'Saved title',
        content: 'Saved content',
        visibility: 'global',
        expectedBindings: replacementBindings
      })
    )
  })

  it('opens confirmation when a binding appears after an empty preflight snapshot', async () => {
    const user = userEvent.setup()
    const addedBindings = [{ type: 'agent' as const, id: 'agent-new' }]
    mocks.refetchBindings.mockResolvedValueOnce([]).mockResolvedValueOnce(addedBindings)
    mocks.updatePrompt
      .mockRejectedValueOnce(DataApiErrorFactory.concurrentModification('Prompt bindings', prompts[1].id))
      .mockResolvedValueOnce(prompts[0])
    render(<PromptSettings />)

    await user.click(screen.getByRole('button', { name: 'common.edit Targeted prompt' }))
    await user.click(screen.getByRole('button', { name: 'save global prompt' }))

    const confirmDialog = await screen.findByRole('dialog', {
      name: 'settings.prompts.visibility.makeGlobalConfirmTitle'
    })
    expect(mocks.updatePrompt).toHaveBeenNthCalledWith(1, {
      title: 'Saved title',
      content: 'Saved content',
      visibility: 'global',
      expectedBindings: []
    })
    expect(confirmDialog).toHaveTextContent('settings.prompts.visibility.makeGlobalConfirmDescription:1')

    await user.click(within(confirmDialog).getByRole('button', { name: 'common.confirm' }))
    await waitFor(() =>
      expect(mocks.updatePrompt).toHaveBeenNthCalledWith(2, {
        title: 'Saved title',
        content: 'Saved content',
        visibility: 'global',
        expectedBindings: addedBindings
      })
    )
  })

  it('does not reuse the previous prompt binding count while a new delete target loads', async () => {
    const user = userEvent.setup()
    mocks.useQuery.mockImplementation((path: string, options?: { params?: { id?: string } }) => {
      if (path === '/prompts') {
        return { data: prompts, error: undefined, isLoading: false, refetch: mocks.refetch }
      }

      const loadingSecondTarget = options?.params?.id === prompts[2].id
      return {
        data: loadingSecondTarget ? undefined : [{ targetId: 'assistant-1' }, { targetId: 'agent-1' }],
        error: undefined,
        isLoading: loadingSecondTarget,
        refetch: mocks.refetchBindings
      }
    })
    render(<PromptSettings />)

    await user.click(screen.getByRole('button', { name: 'common.delete Targeted prompt' }))
    expect(screen.getByRole('dialog', { name: 'settings.prompts.delete' })).toHaveTextContent(
      'settings.prompts.deleteSharedConfirm:2'
    )
    await user.click(screen.getByRole('button', { name: 'common.cancel' }))

    await user.click(screen.getByRole('button', { name: 'common.delete Second targeted prompt' }))

    expect(screen.getByRole('dialog', { name: 'settings.prompts.delete' })).toHaveTextContent(
      'settings.prompts.deleteRestrictedConfirm'
    )
    expect(mocks.useQuery).toHaveBeenCalledWith('/prompts/:id/bindings', {
      enabled: true,
      params: { id: prompts[2].id },
      swrOptions: { keepPreviousData: false }
    })
  })
})
