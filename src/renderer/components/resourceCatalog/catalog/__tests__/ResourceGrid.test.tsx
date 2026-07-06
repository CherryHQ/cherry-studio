import { AssistantPresetPreviewDialog } from '@renderer/components/resourceCatalog/dialogs/detail/AssistantPresetPreviewDialog'
import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as ReactModule from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ResourceCardMenu } from '../ResourceCardMenu'
import { ResourceCard } from '../ResourceCards'
import { ResourceGrid } from '../ResourceGrid'

const { deleteTagMock, ensureTagsMock, renameTagMock, updateAssistantMock } = vi.hoisted(() => ({
  deleteTagMock: vi.fn(),
  ensureTagsMock: vi.fn(),
  renameTagMock: vi.fn(),
  updateAssistantMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'assistants.tags.delete': '删除标签',
          'assistants.tags.deleteConfirm': '确定要删除这个标签吗？',
          'common.delete': '删除',
          'common.rename': '重命名',
          'common.save': '保存',
          'chat.add.assistant.title': '添加助手',
          'assistants.presets.import.action': '导入助手',
          'library.assistant_catalog.add': '添加',
          'library.assistant_catalog.title': '助手库',
          'library.assistant_catalog.go_to_chat': '去对话',
          'library.create_menu.create': '新建助手',
          'library.toolbar.all_tags': '全部标签',
          'library.toolbar.tag_button': '标签',
          'library.type.assistant': '助手'
        }) satisfies Record<string, string>
      )[key] ?? key
  })
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await vi.importActual<typeof ReactModule>('react')
  const PopoverContext = React.createContext<{
    open: boolean
    setOpen: (open: boolean) => void
  }>({
    open: false,
    setOpen: () => {}
  })
  const ContextMenuContext = React.createContext<{
    open: boolean
    setOpen: (open: boolean) => void
  }>({
    open: false,
    setOpen: () => {}
  })

  return {
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
    ConfirmDialog: ({
      cancelText,
      confirmText,
      description,
      onConfirm,
      open,
      title
    }: {
      cancelText?: string
      confirmText?: string
      description?: ReactNode
      onConfirm?: () => void | Promise<void>
      open?: boolean
      title?: ReactNode
    }) =>
      open ? (
        <div role="dialog">
          {title && <h2>{title}</h2>}
          {description && <div>{description}</div>}
          {cancelText && <button type="button">{cancelText}</button>}
          {confirmText && (
            <button type="button" onClick={() => void onConfirm?.()}>
              {confirmText}
            </button>
          )}
        </div>
      ) : null,
    ContextMenu: ({ children }: { children?: ReactNode }) => {
      const [open, setOpen] = React.useState(false)
      return <ContextMenuContext value={{ open, setOpen }}>{children}</ContextMenuContext>
    },
    ContextMenuContent: ({ children }: { children?: ReactNode }) => {
      const { open } = React.use(ContextMenuContext)
      return open ? <div role="menu">{children}</div> : null
    },
    ContextMenuItem: ({
      children,
      onSelect,
      variant,
      ...props
    }: ComponentProps<'button'> & {
      onSelect?: (event: React.MouseEvent<HTMLButtonElement>) => void
      variant?: string
    }) => {
      void variant
      return (
        <button type="button" onClick={(event) => onSelect?.(event)} {...props}>
          {children}
        </button>
      )
    },
    ContextMenuItemContent: ({ children, icon }: { children?: ReactNode; icon?: ReactNode }) => (
      <>
        {icon}
        <span>{children}</span>
      </>
    ),
    ContextMenuTrigger: ({ asChild, children }: { asChild?: boolean; children?: ReactNode }) => {
      const { setOpen } = React.use(ContextMenuContext)
      void asChild
      return (
        <span
          onContextMenu={(event) => {
            event.preventDefault()
            setOpen(true)
          }}>
          {children}
        </span>
      )
    },
    EmptyState: ({ description, title }: { description?: string; title?: string }) => (
      <div data-testid="empty-state">
        {title && <div>{title}</div>}
        {description && <div>{description}</div>}
      </div>
    ),
    Dialog: ({ children, open }: { children?: ReactNode; open?: boolean }) => (open ? <>{children}</> : null),
    DialogContent: ({ children }: { children?: ReactNode }) => <div role="dialog">{children}</div>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <footer>{children}</footer>,
    DialogHeader: ({ children }: { children?: ReactNode }) => <header>{children}</header>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    Input: (props: ComponentProps<'input'> & { className?: string }) => <input {...props} />,
    MenuDivider: () => <div data-testid="menu-divider" />,
    MenuList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    MenuItem: ({
      icon,
      label,
      onClick,
      suffix,
      ...props
    }: {
      icon?: ReactNode
      label: ReactNode
      onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
      suffix?: ReactNode
    }) => (
      <button type="button" onClick={onClick} {...props}>
        {icon}
        <span>{label}</span>
        {suffix}
      </button>
    ),
    Popover: ({
      children,
      open,
      onOpenChange
    }: {
      children?: ReactNode
      open?: boolean
      onOpenChange?: (open: boolean) => void
    }) => {
      const [internalOpen, setInternalOpen] = React.useState(open ?? false)
      const actualOpen = open ?? internalOpen
      const setOpen = (nextOpen: boolean) => {
        if (open === undefined) setInternalOpen(nextOpen)
        onOpenChange?.(nextOpen)
      }

      return <PopoverContext value={{ open: actualOpen, setOpen }}>{children}</PopoverContext>
    },
    PopoverContent: ({ children }: { children?: ReactNode }) => {
      const { open } = React.use(PopoverContext)
      return open ? <div>{children}</div> : null
    },
    PopoverTrigger: ({ children, asChild }: { children?: ReactNode; asChild?: boolean }) => {
      const { open, setOpen } = React.use(PopoverContext)
      void asChild

      return <span onPointerDownCapture={() => setOpen(!open)}>{children}</span>
    },
    Separator: () => <div />,
    Skeleton: (props: ComponentProps<'div'>) => <div data-testid="skeleton" {...props} />,
    Tabs: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    TabsList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    TabsTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>
  }
})

vi.mock('@renderer/hooks/resourceCatalog', () => ({
  useAssistantMutationsById: () => ({
    updateAssistant: updateAssistantMock
  })
}))

vi.mock('@renderer/hooks/useTags', () => ({
  useDeleteTag: () => ({
    deleteTag: deleteTagMock
  }),
  useEnsureTags: () => ({
    ensureTags: ensureTagsMock
  }),
  useRenameTag: () => ({
    renameTag: renameTagMock
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

function createAssistantResource(overrides: Partial<Extract<ResourceItem, { type: 'assistant' }>> = {}): ResourceItem {
  return {
    id: 'assistant-1',
    type: 'assistant',
    name: 'Assistant',
    description: '',
    avatar: 'A',
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
    raw: {} as Extract<ResourceItem, { type: 'assistant' }>['raw'],
    ...overrides
  }
}

function createAgentResource(): ResourceItem {
  return {
    id: 'agent-1',
    type: 'agent',
    name: 'Agent',
    description: '',
    avatar: 'A',
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
    raw: {} as Extract<ResourceItem, { type: 'agent' }>['raw']
  }
}

function createSkillResource(): ResourceItem {
  return {
    id: 'skill-1',
    type: 'skill',
    name: 'Skill',
    description: '',
    avatar: 'S',
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
    raw: {} as Extract<ResourceItem, { type: 'skill' }>['raw']
  }
}

function createPromptResource(): ResourceItem {
  return {
    id: 'prompt-1',
    type: 'prompt',
    name: 'Prompt',
    description: '',
    avatar: 'Aa',
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
    raw: {} as Extract<ResourceItem, { type: 'prompt' }>['raw']
  }
}

function renderResourceGrid(props: Partial<ComponentProps<typeof ResourceGrid>> = {}) {
  return render(
    <ResourceGrid
      resources={[]}
      isLoading={false}
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
      allTagNames={[]}
      allTags={[]}
      {...props}
    />
  )
}

function getResourceCardProps(overrides: Partial<ComponentProps<typeof ResourceCard>> = {}) {
  return {
    allTagNames: [],
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onEdit: vi.fn(),
    onExport: vi.fn(),
    ...overrides
  }
}

describe('ResourceGrid empty state copy', () => {
  it('renders the optional toolbar leading slot before the search box', () => {
    renderResourceGrid({
      toolbarLeading: <button type="button">Toggle sidebar</button>
    })

    const toggle = screen.getByRole('button', { name: 'Toggle sidebar' })
    const searchInput = screen.getByPlaceholderText('library.toolbar.search_placeholder')

    expect(toggle.compareDocumentPosition(searchInput)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('shows loading placeholders before the empty state while data is loading', () => {
    renderResourceGrid({ isLoading: true })

    expect(screen.getByTestId('resource-grid-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument()
  })

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

describe('ResourceGrid assistant add actions', () => {
  it('renders assistant actions inline and dispatches the selected action', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    const onImportAssistant = vi.fn()
    const onOpenAssistantLibrary = vi.fn()

    renderResourceGrid({
      onCreate,
      onImportAssistant,
      onOpenAssistantLibrary
    })

    expect(screen.getByRole('button', { name: '新建助手' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '助手库' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入助手' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /添加助手/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '助手库' }))

    expect(onOpenAssistantLibrary).toHaveBeenCalledTimes(1)
    expect(onCreate).not.toHaveBeenCalled()
    expect(onImportAssistant).not.toHaveBeenCalled()
  })

  it('hides the assistant library action when the handler is unavailable', () => {
    renderResourceGrid()

    expect(screen.getByRole('button', { name: '新建助手' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '助手库' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入助手' })).toBeInTheDocument()
  })
})

describe('ResourceGrid tag toolbar management', () => {
  beforeEach(() => {
    deleteTagMock.mockReset()
    renameTagMock.mockReset()
  })

  it('keeps unused tags collapsed behind the arrow before the add-tag button', async () => {
    const user = userEvent.setup()

    renderResourceGrid({
      tags: [{ id: 'tag-alpha', name: 'alpha', color: '#111111', count: 1 }],
      allTags: [
        {
          id: 'tag-alpha',
          name: 'alpha',
          color: '#111111',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z'
        },
        {
          id: 'tag-beta',
          name: 'beta',
          color: '#222222',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z'
        }
      ]
    })

    const alphaTag = screen.getByRole('button', { name: /alpha/ })
    const expandButton = screen.getByRole('button', { name: '全部标签' })
    const addTagButton = screen.getByRole('button', { name: '标签' })

    expect(screen.queryByRole('button', { name: /beta/ })).not.toBeInTheDocument()
    expect(alphaTag.compareDocumentPosition(expandButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(expandButton.compareDocumentPosition(addTagButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    await user.click(expandButton)

    const betaTag = screen.getByRole('button', { name: /beta/ })
    expect(betaTag.compareDocumentPosition(screen.getByRole('button', { name: '全部标签' }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
  })

  it('renames a tag from the right-click menu', async () => {
    const user = userEvent.setup()
    const onTagFilter = vi.fn()
    renameTagMock.mockResolvedValueOnce({
      id: 'tag-alpha',
      name: 'renamed',
      color: '#111111',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    })

    renderResourceGrid({
      activeTag: 'alpha',
      onTagFilter,
      tags: [{ id: 'tag-alpha', name: 'alpha', color: '#111111', count: 1 }]
    })

    fireEvent.contextMenu(screen.getByRole('button', { name: /alpha/ }), { clientX: 20, clientY: 30 })
    await user.click(screen.getByRole('button', { name: '重命名' }))
    fireEvent.change(screen.getByLabelText('重命名'), { target: { value: 'renamed' } })
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(renameTagMock).toHaveBeenCalledWith('tag-alpha', 'renamed'))
    expect(onTagFilter).toHaveBeenCalledWith('renamed')
  })

  it('confirms before deleting a tag from the right-click menu', async () => {
    const user = userEvent.setup()
    const onTagFilter = vi.fn()

    renderResourceGrid({
      activeTag: 'alpha',
      onTagFilter,
      tags: [{ id: 'tag-alpha', name: 'alpha', color: '#111111', count: 1 }]
    })

    fireEvent.contextMenu(screen.getByRole('button', { name: /alpha/ }), { clientX: 20, clientY: 30 })
    await user.click(screen.getByRole('button', { name: '删除标签' }))

    expect(screen.getByRole('dialog')).toHaveTextContent('确定要删除这个标签吗？')
    expect(deleteTagMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteTagMock).toHaveBeenCalledWith('tag-alpha'))
    expect(onTagFilter).toHaveBeenCalledWith(null)
  })
})

describe('ResourceGrid card actions', () => {
  it('shows the overflow menu only for assistant cards', () => {
    render(<ResourceCard resource={createAssistantResource()} {...getResourceCardProps()} />)

    expect(screen.getByRole('button', { name: /common.more/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument()
  })

  it('shows a direct delete action when delete is the only card action', async () => {
    const user = userEvent.setup()
    const resource = createAgentResource()
    const onDelete = vi.fn()

    render(<ResourceCard resource={resource} {...getResourceCardProps({ onDelete })} />)

    expect(screen.queryByRole('button', { name: /common.more/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '删除' }))

    expect(onDelete).toHaveBeenCalledWith(resource)
  })

  it('shows only one assistant tag in the compact card layout', () => {
    render(<ResourceCard resource={createAssistantResource({ tag: 'alpha' })} {...getResourceCardProps()} />)

    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.queryByText('beta')).not.toBeInTheDocument()
    expect(screen.queryByText('+2')).not.toBeInTheDocument()
  })
})

describe('Assistant preset preview dialog actions', () => {
  const preset = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Catalog Assistant',
    prompt: 'Prompt',
    group: ['Tools']
  }

  it('adds a preset from the preview dialog', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <AssistantPresetPreviewDialog
        preset={preset}
        open
        onOpenChange={onOpenChange}
        onAdd={onAdd}
        onOpenChat={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: '添加' }))
    expect(onAdd).toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('opens chat for an added preset from the preview dialog', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    const onOpenChat = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <AssistantPresetPreviewDialog
        preset={preset}
        open
        addedAssistantId="assistant-created"
        onOpenChange={onOpenChange}
        onAdd={onAdd}
        onOpenChat={onOpenChat}
      />
    )

    await user.click(screen.getByRole('button', { name: '去对话' }))
    expect(onOpenChat).toHaveBeenCalledWith('assistant-created')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onAdd).not.toHaveBeenCalled()
  })
})

describe('ResourceCardMenu tag binding', () => {
  beforeEach(() => {
    ensureTagsMock.mockReset()
    updateAssistantMock.mockReset()
  })

  it('does not show a tag count in the single-select tag menu trigger', () => {
    render(
      <ResourceCardMenu
        resource={createAssistantResource({ tag: 'alpha' })}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        allTagNames={['alpha', 'beta']}
      />
    )

    expect(screen.getByRole('button', { name: /library.action.manage_tags/ })).not.toHaveTextContent(/\b1\b/)
  })

  it('blocks a second tag write while the first one is still pending', async () => {
    const user = userEvent.setup()
    const pendingTags = createDeferred<Array<{ id: string; name: string }>>()
    ensureTagsMock.mockReturnValueOnce(pendingTags.promise)
    updateAssistantMock.mockResolvedValue({})

    render(
      <ResourceCardMenu
        resource={createAssistantResource()}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        allTagNames={['alpha', 'beta']}
      />
    )

    await user.click(screen.getByRole('button', { name: /library.action.manage_tags/ }))
    expect(screen.getByRole('menu', { name: 'library.config.basic.tags' })).toContainElement(
      screen.getByRole('menuitemradio', { name: 'alpha' })
    )
    await user.click(screen.getByRole('menuitemradio', { name: 'alpha' }))

    await waitFor(() =>
      expect(screen.getByRole('menuitemradio', { name: 'beta' })).toHaveAttribute('aria-disabled', 'true')
    )
    await user.click(screen.getByRole('menuitemradio', { name: 'beta' }))
    expect(ensureTagsMock).toHaveBeenCalledTimes(1)

    pendingTags.resolve([{ id: 'tag-alpha', name: 'alpha' }])

    await waitFor(() => {
      expect(updateAssistantMock).toHaveBeenCalledWith({ tagIds: ['tag-alpha'] })
    })
    expect(ensureTagsMock).toHaveBeenCalledTimes(1)
  })

  it('uses roving focus for tag picker radio items', async () => {
    const user = userEvent.setup()

    render(
      <ResourceCardMenu
        resource={createAssistantResource()}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        allTagNames={['alpha', 'beta', 'gamma']}
      />
    )

    await user.click(screen.getByRole('button', { name: /library.action.manage_tags/ }))

    const alpha = screen.getByRole('menuitemradio', { name: 'alpha' })
    const beta = screen.getByRole('menuitemradio', { name: 'beta' })
    const gamma = screen.getByRole('menuitemradio', { name: 'gamma' })

    expect(alpha).toHaveAttribute('tabindex', '0')
    expect(beta).toHaveAttribute('tabindex', '-1')

    alpha.focus()
    expect(alpha).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(beta).toHaveFocus()

    await waitFor(() => {
      expect(alpha).toHaveAttribute('tabindex', '-1')
      expect(beta).toHaveAttribute('tabindex', '0')
    })

    await user.keyboard('{End}')
    expect(gamma).toHaveFocus()

    await user.keyboard('{Home}')
    expect(alpha).toHaveFocus()
  })

  it('replaces the current assistant tag when a different tag is selected', async () => {
    const user = userEvent.setup()
    ensureTagsMock.mockResolvedValueOnce([{ id: 'tag-beta', name: 'beta' }])
    updateAssistantMock.mockResolvedValue({})

    render(
      <ResourceCardMenu
        resource={createAssistantResource({ tag: 'alpha' })}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        allTagNames={['alpha', 'beta']}
      />
    )

    await user.click(screen.getByRole('button', { name: /library.action.manage_tags/ }))
    await user.click(screen.getByRole('menuitemradio', { name: 'beta' }))

    await waitFor(() => expect(ensureTagsMock).toHaveBeenCalledWith(['beta']))
    expect(updateAssistantMock).toHaveBeenCalledWith({ tagIds: ['tag-beta'] })
  })

  it('does not expose tag management for agent, skill, or prompt resources', () => {
    const { rerender } = render(
      <ResourceCardMenu
        resource={createAgentResource()}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        allTagNames={['alpha', 'beta']}
      />
    )

    expect(screen.queryByRole('button', { name: /library.action.manage_tags/ })).not.toBeInTheDocument()

    rerender(
      <ResourceCardMenu
        resource={createSkillResource()}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        allTagNames={['alpha', 'beta']}
      />
    )

    expect(screen.queryByRole('button', { name: /library.action.manage_tags/ })).not.toBeInTheDocument()

    rerender(
      <ResourceCardMenu
        resource={createPromptResource()}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        allTagNames={['alpha', 'beta']}
      />
    )

    expect(screen.queryByRole('button', { name: /library.action.manage_tags/ })).not.toBeInTheDocument()
  })

  it('keeps uninstall available for skill resources without extra menu actions', () => {
    render(
      <ResourceCardMenu
        resource={createSkillResource()}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        allTagNames={[]}
      />
    )

    expect(screen.getByRole('button', { name: /library.action.uninstall/ })).toBeInTheDocument()
    expect(screen.queryByTestId('menu-divider')).not.toBeInTheDocument()
  })

  it('keeps the divider when assistant resources have actions before delete', () => {
    render(
      <ResourceCardMenu
        resource={createAssistantResource()}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        allTagNames={[]}
      />
    )

    expect(screen.queryByRole('button', { name: /common.edit/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('menu-divider')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument()
  })
})
