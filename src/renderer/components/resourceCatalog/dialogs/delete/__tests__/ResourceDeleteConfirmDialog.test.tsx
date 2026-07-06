import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ResourceDeleteConfirmDialog } from '../ResourceDeleteConfirmDialog'

const mocks = vi.hoisted(() => ({
  deleteAgent: vi.fn(),
  deleteAssistant: vi.fn(),
  deletePrompt: vi.fn(),
  uninstallSkill: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'assistants.delete.content': 'Delete assistant content',
          'assistants.delete.title': 'Delete assistant',
          'common.cancel': 'Cancel',
          'common.delete': 'Delete',
          'library.action.uninstall': 'Uninstall',
          'library.delete.agent.content': 'Delete agent content',
          'library.delete.agent.title': 'Delete agent',
          'library.delete.skill.content': 'Uninstall skill content',
          'library.delete.skill.title': 'Uninstall skill',
          'settings.prompts.delete': 'Delete prompt',
          'settings.prompts.deleteConfirm': 'Delete prompt content'
        }) satisfies Record<string, string>
      )[key] ?? key
  })
}))

vi.mock('@cherrystudio/ui', () => ({
  ConfirmDialog: ({
    cancelText,
    confirmLoading,
    confirmText,
    description,
    onConfirm,
    onOpenChange,
    open,
    title
  }: {
    cancelText?: string
    confirmLoading?: boolean
    confirmText?: string
    description?: ReactNode
    onConfirm?: () => Promise<void> | void
    onOpenChange?: (open: boolean) => void
    open?: boolean
    title?: ReactNode
  }) =>
    open ? (
      <div role="dialog" data-loading={confirmLoading ? 'true' : 'false'}>
        <h2>{title}</h2>
        <div>{description}</div>
        <button type="button" onClick={() => onOpenChange?.(false)}>
          {cancelText}
        </button>
        <button type="button" onClick={() => void onConfirm?.()}>
          {confirmText}
        </button>
      </div>
    ) : null
}))

vi.mock('@renderer/hooks/resourceCatalog', () => ({
  useAgentMutationsById: () => ({
    deleteAgent: mocks.deleteAgent
  }),
  useAssistantMutationsById: () => ({
    deleteAssistant: mocks.deleteAssistant
  }),
  usePromptMutationsById: () => ({
    deletePrompt: mocks.deletePrompt
  }),
  useSkillMutationsById: () => ({
    uninstallSkill: mocks.uninstallSkill
  })
}))

function createResource(type: ResourceItem['type']): ResourceItem {
  return {
    id: `${type}-1`,
    type,
    name: type,
    description: '',
    avatar: type[0],
    tags: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    raw: {} as ResourceItem['raw']
  } as ResourceItem
}

describe('ResourceDeleteConfirmDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn()
      }
    })
  })

  it('renders nothing without a selected resource', () => {
    const { container } = render(<ResourceDeleteConfirmDialog resource={null} onClose={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
  })

  it.each([
    ['assistant', 'Delete assistant', 'Delete', mocks.deleteAssistant],
    ['agent', 'Delete agent', 'Delete', mocks.deleteAgent],
    ['skill', 'Uninstall skill', 'Uninstall', mocks.uninstallSkill],
    ['prompt', 'Delete prompt', 'Delete', mocks.deletePrompt]
  ] as const)('dispatches %s deletion through the matching mutation', async (type, title, confirmText, mutation) => {
    const user = userEvent.setup()
    mutation.mockResolvedValueOnce(undefined)

    render(<ResourceDeleteConfirmDialog resource={createResource(type)} onClose={vi.fn()} />)

    expect(screen.getByRole('dialog')).toHaveTextContent(title)
    await user.click(screen.getByRole('button', { name: confirmText }))

    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(1))
  })

  it('closes when the confirm dialog is dismissed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(<ResourceDeleteConfirmDialog resource={createResource('assistant')} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
