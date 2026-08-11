import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  }
]

const mocks = vi.hoisted(() => ({
  applyReorderedList: vi.fn(),
  createPrompt: vi.fn(),
  deletePrompt: vi.fn(),
  refetch: vi.fn(),
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
      </div>
    ) : null
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn() } }))
vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (_error: unknown, prefix: string) => prefix
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
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
  ConfirmDialog: ({ onConfirm, open }: { onConfirm: () => Promise<void>; open: boolean }) =>
    open ? (
      <button type="button" onClick={() => void onConfirm()}>
        confirm delete
      </button>
    ) : null,
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
  Skeleton: (props: ComponentProps<'div'>) => <div {...props} />
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useQuery.mockReturnValue({ data: prompts, error: undefined, isLoading: false, refetch: mocks.refetch })
  mocks.createPrompt.mockResolvedValue(prompts[0])
  mocks.updatePrompt.mockResolvedValue(prompts[0])
  mocks.deletePrompt.mockResolvedValue(undefined)
})

describe('PromptSettings', () => {
  it('lists global and restricted prompts from the settings route', () => {
    render(<PromptSettings />)

    expect(mocks.useQuery).toHaveBeenCalledWith('/prompts', {})
    expect(screen.getByText('Global prompt')).toBeInTheDocument()
    expect(screen.getByText('Targeted prompt')).toBeInTheDocument()
    expect(screen.getByText('settings.prompts.visibility.global.badge')).toBeInTheDocument()
    expect(screen.getByText('settings.prompts.visibility.restricted.badge')).toBeInTheDocument()
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
})
