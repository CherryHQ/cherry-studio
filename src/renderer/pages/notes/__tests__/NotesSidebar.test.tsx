import type { NotesTreeNode } from '@renderer/types/note'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NotesSidebar from '../NotesSidebar'

const searchMock = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@renderer/data/hooks/useCache', async () => {
  const React = await import('react')

  return {
    useCache: () => React.useState(false)
  }
})

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    type = 'button',
    variant,
    size,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => {
    void variant
    void size
    return (
      <button type={type} {...props}>
        {children}
      </button>
    )
  },
  ContextMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuItem: ({
    children,
    onSelect,
    type,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { onSelect?: () => void }) => (
    <button type={type ?? 'button'} onClick={onSelect} {...props}>
      {children}
    </button>
  ),
  ContextMenuItemContent: ({ children }: { children: ReactNode; icon?: ReactNode }) => <span>{children}</span>,
  ContextMenuSeparator: () => <hr />,
  ContextMenuTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => <>{children}</>,
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  MenuDivider: (props: HTMLAttributes<HTMLDivElement>) => <div {...props} />,
  MenuItem: ({
    active,
    label,
    onClick,
    suffix,
    type,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; label: string; suffix?: ReactNode }) => {
    void active
    void suffix
    return (
      <button type={type ?? 'button'} onClick={onClick} {...props}>
        {label}
      </button>
    )
  },
  MenuList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode; align?: string }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode; content?: string; delay?: number; classNames?: unknown }) => (
    <>{children}</>
  )
}))

vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: ({ list, children }: { list: any[]; children: (item: any) => ReactNode }) => (
    <div data-testid="notes-virtual-list">
      {list.map((item, index) => (
        <div key={item.kind === 'node' ? item.node.id : `${item.kind}-${index}`}>{children(item)}</div>
      ))}
    </div>
  )
}))

vi.mock('../components/TreeNode', () => ({
  default: ({ node, depth }: { node: NotesTreeNode; depth: number }) => (
    <div data-depth={depth} data-testid="tree-node">
      {node.name}
    </div>
  )
}))

vi.mock('../hooks/useNotesDragAndDrop', () => ({
  useNotesDragAndDrop: () => ({
    draggedNodeId: null,
    dragOverNodeId: null,
    dragPosition: 'inside',
    handleDragStart: vi.fn(),
    handleDragOver: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDrop: vi.fn(),
    handleDragEnd: vi.fn()
  })
}))

vi.mock('../hooks/useNotesEditing', () => ({
  useNotesEditing: () => ({
    editingNodeId: null,
    renamingNodeIds: new Set<string>(),
    newlyRenamedNodeIds: new Set<string>(),
    inPlaceEdit: {
      isEditing: false,
      inputProps: {}
    },
    handleStartEdit: vi.fn(),
    handleAutoRename: vi.fn()
  })
}))

vi.mock('../hooks/useNotesFileUpload', () => ({
  useNotesFileUpload: () => ({
    handleDropFiles: vi.fn(),
    handleSelectFiles: vi.fn(),
    handleSelectFolder: vi.fn()
  })
}))

vi.mock('../hooks/useNotesMenu', () => ({
  useNotesMenu: () => ({
    renderMenuItems: vi.fn()
  })
}))

vi.mock('../hooks/useFullTextSearch', () => ({
  useFullTextSearch: () => ({
    search: searchMock,
    cancel: vi.fn(),
    reset: vi.fn(),
    isSearching: false,
    results: [],
    stats: {
      total: 0,
      fileNameMatches: 0,
      contentMatches: 0,
      bothMatches: 0
    }
  })
}))

const noop = vi.fn()

const defaultProps = {
  activeFilePath: undefined,
  notesTree: [] as NotesTreeNode[],
  onCreateFolder: noop,
  onCreateNote: noop,
  onDeleteNode: noop,
  onMoveNode: noop,
  onRenameNode: noop,
  onSelectNode: noop,
  onSortNodes: noop,
  onToggleExpanded: noop,
  onToggleStar: noop,
  onUploadFiles: noop,
  selectedFolderId: null,
  sortType: 'sort_a2z' as const
}

const makeNode = (overrides: Partial<NotesTreeNode>): NotesTreeNode => ({
  createdAt: '2026-01-01T00:00:00.000Z',
  externalPath: `/notes/${overrides.name ?? overrides.id}.md`,
  id: overrides.id ?? 'node',
  name: overrides.name ?? 'Node',
  treePath: `/${overrides.name ?? overrides.id}`,
  type: 'file',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides
})

const notesTree: NotesTreeNode[] = [
  makeNode({
    id: 'folder',
    name: 'Folder',
    type: 'folder',
    expanded: true,
    externalPath: '/notes/Folder',
    treePath: '/Folder',
    children: [
      makeNode({
        id: 'starred-child',
        name: 'Starred Child',
        externalPath: '/notes/Folder/starred-child.md',
        isStarred: true,
        treePath: '/Folder/starred-child'
      }),
      makeNode({
        id: 'plain-child',
        name: 'Plain Child',
        externalPath: '/notes/Folder/plain-child.md',
        isStarred: false,
        treePath: '/Folder/plain-child'
      })
    ]
  }),
  makeNode({
    id: 'starred-root',
    name: 'Starred Root',
    externalPath: '/notes/starred-root.md',
    isStarred: true,
    treePath: '/starred-root'
  })
]

const renderSidebar = (props: Partial<typeof defaultProps> = {}) =>
  render(<NotesSidebar {...defaultProps} {...props} />)

describe('NotesSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchMock.mockClear()
  })

  it('shows only the library group by default', () => {
    renderSidebar({ notesTree })

    expect(screen.getByText('notes.my_library')).toBeInTheDocument()
    expect(screen.queryByText('notes.favorites_section')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'notes.view_favorites' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'notes.view_favorites' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('notes.drop_markdown_hint')).toBeInTheDocument()
    expect(screen.getByText('Folder')).toBeInTheDocument()
    expect(screen.getByText('Starred Child')).toBeInTheDocument()
    expect(screen.getByText('Plain Child')).toBeInTheDocument()
  })

  it('toggles to a flat favorites-only list and back', async () => {
    renderSidebar({ notesTree })

    fireEvent.click(screen.getByRole('button', { name: 'notes.view_favorites' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'notes.back_to_library' })).toHaveAttribute('aria-pressed', 'true')
    })
    expect(screen.getByRole('button', { name: 'notes.back_to_library' })).not.toHaveTextContent('2')
    expect(screen.queryByText('Folder')).not.toBeInTheDocument()
    expect(screen.getByText('Starred Child')).toBeInTheDocument()
    expect(screen.getByText('Starred Root')).toBeInTheDocument()
    expect(screen.queryByText('Plain Child')).not.toBeInTheDocument()
    expect(screen.getByText('notes.new_note')).toBeInTheDocument()
    expect(screen.queryByText('notes.drop_markdown_hint')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'notes.back_to_library' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'notes.view_favorites' })).toHaveAttribute('aria-pressed', 'false')
    })
    expect(screen.getByText('Folder')).toBeInTheDocument()
    expect(screen.getByText('Plain Child')).toBeInTheDocument()
  })

  it('shows the favorites empty hint when the filter has no results', async () => {
    renderSidebar({ notesTree: [makeNode({ id: 'plain', name: 'Plain', isStarred: false })] })

    fireEvent.click(screen.getByRole('button', { name: 'notes.view_favorites' }))

    await waitFor(() => {
      expect(screen.getByText('notes.favorites_empty_hint')).toBeInTheDocument()
    })
    expect(screen.queryByText('Plain')).not.toBeInTheDocument()
  })

  it('searches only favorite notes while the favorites filter is active', async () => {
    renderSidebar({ notesTree })

    fireEvent.click(screen.getByRole('button', { name: 'notes.view_favorites' }))
    fireEvent.change(screen.getByPlaceholderText('knowledge.search_placeholder'), { target: { value: 'starred' } })

    await waitFor(() => {
      expect(searchMock).toHaveBeenCalled()
    })
    const searchedNodes = searchMock.mock.calls.at(-1)?.[0] as NotesTreeNode[]
    expect(searchedNodes.map((node) => node.id)).toEqual(['starred-child', 'starred-root'])
  })

  it('leaves the favorites filter before creating from the top action', async () => {
    const onCreateNote = vi.fn()
    renderSidebar({ notesTree, onCreateNote })

    fireEvent.click(screen.getByRole('button', { name: 'notes.view_favorites' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'notes.back_to_library' })).toHaveAttribute('aria-pressed', 'true')
    })

    fireEvent.click(screen.getByText('notes.new_note'))

    expect(onCreateNote).toHaveBeenCalledWith('notes.untitled_note')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'notes.view_favorites' })).toHaveAttribute('aria-pressed', 'false')
    })
    expect(screen.getByText('Plain Child')).toBeInTheDocument()
  })
})
