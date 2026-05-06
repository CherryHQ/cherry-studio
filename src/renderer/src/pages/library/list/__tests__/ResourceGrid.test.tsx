import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ComponentType, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourceItem } from '../../types'
import { FixedCardMenu } from '../ResourceGrid'

const { ensureTagsMock, syncEntityTagsMock, updateAgentMock, updateAssistantMock } = vi.hoisted(() => ({
  ensureTagsMock: vi.fn(),
  syncEntityTagsMock: vi.fn(),
  updateAgentMock: vi.fn(),
  updateAssistantMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      whileHover: _whileHover,
      ...props
    }: ComponentProps<'div'> & Record<string, unknown>) => <div {...props}>{children}</div>,
    create: (Component: ComponentType<Record<string, unknown>>) => Component
  }
}))

vi.mock('@renderer/pages/store/assistants/presets/components/AssistantPresetGroupIcon', () => ({
  AssistantPresetGroupIcon: () => <span />
}))

vi.mock('@cherrystudio/ui', () => ({
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    className: _className,
    loading: _loading,
    size: _size,
    variant: _variant,
    ...props
  }: ComponentProps<'button'> & { loading?: boolean; size?: string; variant?: string }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Checkbox: ({
    checked = false,
    className: _className,
    onCheckedChange,
    size: _size,
    ...props
  }: Omit<ComponentProps<'button'>, 'onChange'> & {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
    size?: string
  }) => (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
      {...props}
    />
  ),
  EmptyState: () => <div />,
  Input: ({ className: _className, ...props }: ComponentProps<'input'> & { className?: string }) => (
    <input {...props} />
  ),
  MenuDivider: () => <div />,
  MenuItem: ({
    icon,
    label,
    onClick,
    suffix
  }: {
    icon?: ReactNode
    label: ReactNode
    onClick?: () => void
    suffix?: ReactNode
  }) => (
    <button type="button" onClick={onClick}>
      {icon}
      <span>{label}</span>
      {suffix}
    </button>
  ),
  Separator: () => <div />
}))

vi.mock('../../adapters/agentAdapter', () => ({
  useAgentMutationsById: () => ({
    updateAgent: updateAgentMock
  })
}))

vi.mock('../../adapters/assistantAdapter', () => ({
  useAssistantMutationsById: () => ({
    updateAssistant: updateAssistantMock
  })
}))

vi.mock('../../adapters/tagAdapter', () => ({
  useEnsureTags: () => ({
    ensureTags: ensureTagsMock
  }),
  useSyncEntityTags: () => ({
    syncEntityTags: syncEntityTagsMock
  }),
  useTagList: () => ({
    tags: [
      { id: 'tag-alpha', name: 'alpha', color: '#111111' },
      { id: 'tag-beta', name: 'beta', color: '#222222' }
    ]
  })
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createAgentResource(): ResourceItem {
  return {
    id: 'agent-1',
    type: 'agent',
    name: 'Agent',
    description: '',
    avatar: 'A',
    tags: [],
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
    raw: null
  }
}

describe('FixedCardMenu tag binding', () => {
  beforeEach(() => {
    ensureTagsMock.mockReset()
    syncEntityTagsMock.mockReset()
    updateAgentMock.mockReset()
    updateAssistantMock.mockReset()
  })

  it('blocks a second tag write while the first one is still pending', async () => {
    const user = userEvent.setup()
    const pendingTags = createDeferred<Array<{ id: string; name: string }>>()
    ensureTagsMock.mockReturnValueOnce(pendingTags.promise)
    updateAgentMock.mockResolvedValue({})
    const onUpdateResourceTags = vi.fn()

    render(
      <FixedCardMenu
        x={240}
        y={120}
        resource={createAgentResource()}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        onUpdateResourceTags={onUpdateResourceTags}
        allTagNames={['alpha', 'beta']}
      />
    )

    await user.click(screen.getByRole('button', { name: /library.action.manage_tags/ }))
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0])

    await waitFor(() => expect(checkboxes[1]).toBeDisabled())
    await user.click(checkboxes[1])
    expect(ensureTagsMock).toHaveBeenCalledTimes(1)

    pendingTags.resolve([{ id: 'tag-alpha', name: 'alpha' }])

    await waitFor(() => {
      expect(updateAgentMock).toHaveBeenCalledWith({ tagIds: ['tag-alpha'] })
    })
    expect(onUpdateResourceTags).toHaveBeenCalledWith('agent-1', ['alpha'])
    expect(ensureTagsMock).toHaveBeenCalledTimes(1)
  })
})
