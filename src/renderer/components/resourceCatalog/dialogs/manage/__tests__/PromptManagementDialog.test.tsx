import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PromptManagementDialog } from '../PromptManagementDialog'

const promptsFixture = [
  {
    id: '018f8f16-3540-7cc2-b3cc-11ef1e3f35ac',
    title: 'Plan route',
    content: 'Help me plan a route from ${from} to ${to}',
    orderKey: 'a0',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z'
  },
  {
    id: '018f8f16-3540-7cc2-b3cc-11ef1e3f35ad',
    title: 'Summarize',
    content: 'Summarize this content',
    orderKey: 'a1',
    createdAt: '2026-05-02T00:00:00.000Z',
    updatedAt: '2026-05-02T00:00:00.000Z'
  }
]

const mocks = vi.hoisted(() => ({
  createPrompt: vi.fn(),
  deletePrompt: vi.fn(),
  refetch: vi.fn(),
  updatePrompt: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn()
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: (...args: unknown[]) => mocks.useMutation(...args),
  useQuery: (...args: unknown[]) => mocks.useQuery(...args)
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/edit', () => ({
  PromptEditDialog: ({
    onCancel,
    onSave,
    open,
    prompt
  }: {
    onCancel: () => void
    onSave: (data: { title: string; content: string }) => Promise<void>
    open: boolean
    prompt?: { title: string } | null
  }) =>
    open ? (
      <div data-testid="prompt-edit-dialog">
        <span>{prompt ? `edit:${prompt.title}` : 'create'}</span>
        <button type="button" onClick={() => void onSave({ title: 'Saved title', content: 'Saved content' })}>
          save prompt
        </button>
        <button type="button" onClick={onCancel}>
          cancel prompt
        </button>
      </div>
    ) : null
}))

vi.mock('lucide-react', () => ({
  Pencil: () => <span data-testid="pencil-icon" />,
  Plus: () => <span data-testid="plus-icon" />,
  Search: () => <span data-testid="search-icon" />,
  Trash2: () => <span data-testid="trash-icon" />,
  X: () => <span data-testid="x-icon" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@cherrystudio/ui', () => ({
  Alert: ({ action, description, message }: { action?: ReactNode; description?: ReactNode; message?: ReactNode }) => (
    <div role="alert">
      <span>{message}</span>
      <span>{description}</span>
      {action}
    </div>
  ),
  Button: ({
    children,
    loading,
    size,
    variant,
    ...props
  }: ComponentProps<'button'> & { loading?: boolean; size?: string; variant?: string }) => {
    void size
    void variant
    return (
      <button type="button" data-loading={loading ? 'true' : undefined} {...props}>
        {children}
      </button>
    )
  },
  ConfirmDialog: ({
    confirmLoading,
    onConfirm,
    onOpenChange,
    open,
    title
  }: {
    confirmLoading?: boolean
    onConfirm?: () => Promise<void> | void
    onOpenChange?: (open: boolean) => void
    open?: boolean
    title?: ReactNode
  }) =>
    open ? (
      <div data-testid="confirm-dialog">
        <span>{title}</span>
        <button type="button" data-loading={confirmLoading ? 'true' : undefined} onClick={() => void onConfirm?.()}>
          confirm delete
        </button>
        <button type="button" onClick={() => onOpenChange?.(false)}>
          cancel delete
        </button>
      </div>
    ) : null,
  Dialog: ({ children, open }: { children?: ReactNode; open?: boolean }) => (open ? <>{children}</> : null),
  DialogContent: ({
    children,
    closeOnOverlayClick,
    ...props
  }: ComponentProps<'div'> & { closeOnOverlayClick?: boolean }) => {
    void closeOnOverlayClick
    return <div {...props}>{children}</div>
  },
  DialogHeader: ({ children }: { children?: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  EmptyState: ({ title }: { title?: ReactNode }) => <div data-testid="empty-state">{title}</div>,
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
  Skeleton: (props: ComponentProps<'div'>) => <div data-testid="skeleton" {...props} />
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useQuery.mockReturnValue({
    data: promptsFixture,
    error: undefined,
    isLoading: false,
    refetch: mocks.refetch
  })
  mocks.useMutation.mockImplementation((method: string) => {
    if (method === 'POST') return { trigger: mocks.createPrompt, isLoading: false }
    if (method === 'PATCH') return { trigger: mocks.updatePrompt, isLoading: false }
    return { trigger: mocks.deletePrompt, isLoading: false }
  })
  mocks.createPrompt.mockResolvedValue(promptsFixture[0])
  mocks.updatePrompt.mockResolvedValue(promptsFixture[0])
  mocks.deletePrompt.mockResolvedValue(undefined)
  mocks.refetch.mockResolvedValue(undefined)
})

function renderDialog() {
  return render(<PromptManagementDialog open onOpenChange={vi.fn()} />)
}

describe('PromptManagementDialog', () => {
  it('renders prompts in a compact list', () => {
    renderDialog()

    expect(screen.getByText('settings.prompts.title')).toBeInTheDocument()
    expect(screen.getByText('Plan route')).toBeInTheDocument()
    expect(screen.getByText('Help me plan a route from ${from} to ${to}')).toBeInTheDocument()
    expect(screen.getByText('Summarize')).toBeInTheDocument()
  })

  it('passes search text to the prompts query', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByPlaceholderText('library.toolbar.search_placeholder'), 'route')

    await waitFor(() => {
      expect(mocks.useQuery).toHaveBeenLastCalledWith(
        '/prompts',
        expect.objectContaining({ query: { search: 'route' } })
      )
    })
  })

  it('creates and edits prompts through PromptEditDialog', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: 'settings.prompts.add' }))
    expect(screen.getByTestId('prompt-edit-dialog')).toHaveTextContent('create')
    await user.click(screen.getByRole('button', { name: 'save prompt' }))

    await waitFor(() => expect(mocks.createPrompt).toHaveBeenCalledWith({ body: expect.any(Object) }))
    expect(mocks.refetch).toHaveBeenCalled()

    await user.click(screen.getAllByRole('button', { name: 'common.edit' })[0])
    expect(screen.getByTestId('prompt-edit-dialog')).toHaveTextContent('edit:Plan route')
    await user.click(screen.getByRole('button', { name: 'save prompt' }))

    await waitFor(() => expect(mocks.updatePrompt).toHaveBeenCalledWith({ body: expect.any(Object) }))
  })

  it('deletes prompts after confirmation', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getAllByRole('button', { name: 'common.delete' })[0])
    expect(screen.getByTestId('confirm-dialog')).toHaveTextContent('settings.prompts.delete')

    await user.click(screen.getByRole('button', { name: 'confirm delete' }))

    await waitFor(() => expect(mocks.deletePrompt).toHaveBeenCalled())
    expect(mocks.refetch).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument())
  })

  it('renders loading, empty, and error states', () => {
    mocks.useQuery.mockReturnValueOnce({
      data: [],
      error: undefined,
      isLoading: true,
      refetch: mocks.refetch
    })
    const { rerender } = renderDialog()
    expect(screen.getAllByTestId('skeleton')).not.toHaveLength(0)

    mocks.useQuery.mockReturnValueOnce({
      data: [],
      error: undefined,
      isLoading: false,
      refetch: mocks.refetch
    })
    rerender(<PromptManagementDialog open onOpenChange={vi.fn()} />)
    expect(screen.getByTestId('empty-state')).toHaveTextContent('library.empty_state.title')

    mocks.useQuery.mockReturnValueOnce({
      data: [],
      error: new Error('load failed'),
      isLoading: false,
      refetch: mocks.refetch
    })
    rerender(<PromptManagementDialog open onOpenChange={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('load failed')
  })
})
