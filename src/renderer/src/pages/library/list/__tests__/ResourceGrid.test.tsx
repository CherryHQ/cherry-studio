import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourceItem } from '../../types'
import { FixedCardMenu } from '../ResourceCardMenu'
import { ResourceGrid } from '../ResourceGrid'

const { ensureTagsMock, updateAssistantMock } = vi.hoisted(() => ({
  ensureTagsMock: vi.fn(),
  updateAssistantMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/pages/store/assistants/presets/components/AssistantPresetGroupIcon', () => ({
  AssistantPresetGroupIcon: () => <span />
}))

vi.mock('@cherrystudio/ui', () => ({
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
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
  Checkbox: ({
    checked = false,
    onCheckedChange,
    size,
    ...props
  }: Omit<ComponentProps<'button'>, 'onChange'> & {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
    size?: string
  }) => {
    void size
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => onCheckedChange?.(!checked)}
        {...props}
      />
    )
  },
  EmptyState: ({ description, title }: { description?: string; title?: string }) => (
    <div data-testid="empty-state">
      {title && <div>{title}</div>}
      {description && <div>{description}</div>}
    </div>
  ),
  Input: (props: ComponentProps<'input'> & { className?: string }) => <input {...props} />,
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

vi.mock('../../adapters/assistantAdapter', () => ({
  useAssistantMutationsById: () => ({
    updateAssistant: updateAssistantMock
  })
}))

vi.mock('../../adapters/tagAdapter', () => ({
  useEnsureTags: () => ({
    ensureTags: ensureTagsMock
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

function createAssistantResource(): ResourceItem {
  return {
    id: 'assistant-1',
    type: 'assistant',
    name: 'Assistant',
    description: '',
    avatar: 'A',
    tags: [],
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
    raw: null
  }
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

function createSkillResource(): ResourceItem {
  return {
    id: 'skill-1',
    type: 'skill',
    name: 'Skill',
    description: '',
    avatar: 'S',
    tags: [],
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
    raw: null
  }
}

function createPromptResource(): ResourceItem {
  return {
    id: 'prompt-1',
    type: 'prompt',
    name: 'Prompt',
    description: '',
    avatar: 'Aa',
    tags: [],
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
    raw: null
  }
}

function renderResourceGrid(props: Partial<ComponentProps<typeof ResourceGrid>> = {}) {
  return render(
    <ResourceGrid
      resources={[]}
      activeResourceType="assistant"
      search=""
      onSearchChange={vi.fn()}
      onEdit={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
      onExport={vi.fn()}
      onCreate={vi.fn()}
      onImportAssistant={vi.fn()}
      tags={[]}
      activeTag={null}
      onTagFilter={vi.fn()}
      onAddTag={vi.fn()}
      onUpdateResourceTags={vi.fn()}
      allTagNames={[]}
      {...props}
    />
  )
}

describe('ResourceGrid empty state copy', () => {
  it('uses the generic resource empty copy when there is no search', () => {
    renderResourceGrid()

    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(screen.getByText('library.empty_state.title')).toBeInTheDocument()
    expect(screen.getByText('library.empty_state.description')).toBeInTheDocument()
    expect(screen.queryByText('library.empty_state.empty_title')).not.toBeInTheDocument()
    expect(screen.queryByText('library.empty_state.empty_description')).not.toBeInTheDocument()
  })

  it('uses the no-match copy when search has no results', () => {
    renderResourceGrid({ search: 'missing' })

    expect(screen.getByText('library.empty_state.no_match_title')).toBeInTheDocument()
    expect(screen.getByText('library.empty_state.no_match_description')).toBeInTheDocument()
  })
})

describe('FixedCardMenu tag binding', () => {
  beforeEach(() => {
    ensureTagsMock.mockReset()
    updateAssistantMock.mockReset()
  })

  it('blocks a second tag write while the first one is still pending', async () => {
    const user = userEvent.setup()
    const pendingTags = createDeferred<Array<{ id: string; name: string }>>()
    ensureTagsMock.mockReturnValueOnce(pendingTags.promise)
    updateAssistantMock.mockResolvedValue({})
    const onUpdateResourceTags = vi.fn()

    render(
      <FixedCardMenu
        x={240}
        y={120}
        resource={createAssistantResource()}
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
      expect(updateAssistantMock).toHaveBeenCalledWith({ tagIds: ['tag-alpha'] })
    })
    expect(onUpdateResourceTags).toHaveBeenCalledWith('assistant-1', ['alpha'])
    expect(ensureTagsMock).toHaveBeenCalledTimes(1)
  })

  it('does not expose tag management for agent, skill, or prompt resources', () => {
    const { rerender } = render(
      <FixedCardMenu
        x={240}
        y={120}
        resource={createAgentResource()}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        onUpdateResourceTags={vi.fn()}
        allTagNames={['alpha', 'beta']}
      />
    )

    expect(screen.queryByRole('button', { name: /library.action.manage_tags/ })).not.toBeInTheDocument()

    rerender(
      <FixedCardMenu
        x={240}
        y={120}
        resource={createSkillResource()}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        onUpdateResourceTags={vi.fn()}
        allTagNames={['alpha', 'beta']}
      />
    )

    expect(screen.queryByRole('button', { name: /library.action.manage_tags/ })).not.toBeInTheDocument()

    rerender(
      <FixedCardMenu
        x={240}
        y={120}
        resource={createPromptResource()}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        onUpdateResourceTags={vi.fn()}
        allTagNames={['alpha', 'beta']}
      />
    )

    expect(screen.queryByRole('button', { name: /library.action.manage_tags/ })).not.toBeInTheDocument()
  })
})
