import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileTreeNode, FileTreeProps } from '@renderer/components/FileTree'
import type { SearchResult } from '@renderer/services/NotesSearchService'

const mocks = vi.hoisted(() => ({
  handleSelectFiles: vi.fn(),
  handleSelectFolder: vi.fn(),
  searchResults: [] as SearchResult[]
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key}:${options.count}`)
  })
}))

vi.mock('@renderer/components/command', () => ({
  CommandContextMenu: ({ children }: { children: React.ReactNode }) => children
}))

vi.mock('@renderer/components/FileTree', () => ({
  FileTree: ({ nodes, renderRowDetail }: FileTreeProps) =>
    nodes.map((node: FileTreeNode) => (
      <div key={node.id} data-testid={`row-${node.id}`}>
        {renderRowDetail?.(node)}
      </div>
    ))
}))

vi.mock('@renderer/hooks/useNotesQuery', () => ({
  useActiveNode: () => ({ activeNode: undefined })
}))

vi.mock('@renderer/pages/notes/NotesSidebarHeader', () => ({
  default: ({
    onToggleSearchView,
    onSetSearchKeyword
  }: {
    onToggleSearchView: () => void
    onSetSearchKeyword: (keyword: string) => void
  }) => (
    <>
      <button type="button" onClick={onToggleSearchView}>
        toggle search
      </button>
      <button type="button" onClick={() => onSetSearchKeyword('todo')}>
        type keyword
      </button>
    </>
  )
}))

vi.mock('../hooks/useFullTextSearch', () => ({
  useFullTextSearch: () => ({
    search: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
    isSearching: false,
    results: mocks.searchResults,
    stats: { total: 0, fileNameMatches: 0, contentMatches: 0, bothMatches: 0 }
  })
}))

vi.mock('../hooks/useNotesEditing', () => ({
  useNotesEditing: () => ({
    editingNodeId: null,
    renamingNodeIds: new Set(),
    newlyRenamedNodeIds: new Set(),
    inPlaceEdit: { isEditing: false, inputProps: {} },
    handleStartEdit: vi.fn(),
    handleAutoRename: vi.fn()
  })
}))

vi.mock('../hooks/useNotesFileUpload', () => ({
  useNotesFileUpload: () => ({
    handleDropFiles: vi.fn(),
    handleSelectFiles: mocks.handleSelectFiles,
    handleSelectFolder: mocks.handleSelectFolder
  })
}))

vi.mock('../hooks/useNotesMenu', () => ({
  useNotesMenu: () => ({ getMenuItems: () => [] })
}))

const NotesSidebar = (await import('../NotesSidebar')).default

function renderSidebar(onLocateNoteLine = vi.fn()) {
  return render(
    <NotesSidebar
      onCreateFolder={vi.fn()}
      onCreateNote={vi.fn()}
      onSelectNode={vi.fn()}
      onDeleteNode={vi.fn()}
      onRenameNode={vi.fn()}
      onToggleExpanded={vi.fn()}
      onToggleStar={vi.fn()}
      onMoveNode={vi.fn()}
      onSortNodes={vi.fn()}
      onUploadFiles={vi.fn()}
      onLocateNoteLine={onLocateNoteLine}
      notesTree={[]}
      sortType="sort_a2z"
    />
  )
}

const contentResult = (lineNumbers: number[]): SearchResult => ({
  id: '/notes/plan.md',
  name: 'plan',
  type: 'file',
  treePath: '/plan',
  externalPath: '/notes/plan.md',
  createdAt: '',
  updatedAt: '',
  matchType: 'content',
  score: 1,
  matches: lineNumbers.map((lineNumber) => ({
    lineNumber,
    lineContent: `todo on line ${lineNumber}`,
    matchStart: 0,
    matchEnd: 4,
    context: `todo on line ${lineNumber}`
  }))
})

describe('NotesSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.searchResults.length = 0
  })

  it('lists content matches under a search result and locates the clicked line', () => {
    mocks.searchResults.push(contentResult([2, 9, 14, 30, 41]))
    const onLocateNoteLine = vi.fn()
    renderSidebar(onLocateNoteLine)

    fireEvent.click(screen.getByRole('button', { name: 'toggle search' }))
    fireEvent.click(screen.getByRole('button', { name: 'type keyword' }))
    const row = within(screen.getByTestId('row-/notes/plan.md'))

    expect(row.getByRole('button', { name: /^2 todo on line 2$/ })).toBeInTheDocument()
    expect(row.getByRole('button', { name: /^14 todo on line 14$/ })).toBeInTheDocument()
    expect(row.queryByRole('button', { name: /^30 todo/ })).not.toBeInTheDocument()

    fireEvent.click(row.getByRole('button', { name: 'notes.search.more_matches:2' }))
    expect(row.getByRole('button', { name: /^41 todo on line 41$/ })).toBeInTheDocument()

    fireEvent.click(row.getByRole('button', { name: /^30 todo on line 30$/ }))
    expect(onLocateNoteLine).toHaveBeenCalledWith(
      '/notes/plan.md',
      expect.objectContaining({ lineNumber: 30, lineContent: 'todo on line 30' })
    )

    fireEvent.click(row.getByRole('button', { name: 'notes.search.show_less' }))
    expect(row.queryByRole('button', { name: /^41 todo/ })).not.toBeInTheDocument()
  })

  it('opens the markdown file picker when the import hint is clicked', () => {
    renderSidebar()

    fireEvent.click(screen.getByText('notes.drop_markdown_hint'))

    expect(mocks.handleSelectFiles).toHaveBeenCalledOnce()
    expect(mocks.handleSelectFolder).not.toHaveBeenCalled()
  })
})
