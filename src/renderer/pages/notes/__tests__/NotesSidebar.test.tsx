import type { NotesSortType } from '@renderer/types/note'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  cancel: vi.fn(),
  reset: vi.fn(),
  isSearching: false,
  results: [] as unknown[],
  resultsKeyword: '',
  stats: { total: 0, nameMatches: 0, contentMatches: 0 },
  handleSelectFiles: vi.fn(),
  handleSelectFolder: vi.fn(),
  t: (key: string) => key
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.t })
}))

vi.mock('../hooks/useFullTextSearch', () => ({
  useFullTextSearch: () => ({
    search: mocks.search,
    cancel: mocks.cancel,
    reset: mocks.reset,
    isSearching: mocks.isSearching,
    results: mocks.results,
    resultsKeyword: mocks.resultsKeyword,
    stats: mocks.stats,
    error: null
  })
}))

vi.mock('../hooks/useNotesEditing', () => ({
  useNotesEditing: () => ({
    editingNodeId: null,
    renamingNodeIds: new Set<string>(),
    newlyRenamedNodeIds: new Set<string>(),
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
  useNotesMenu: () => ({
    getMenuItems: vi.fn(() => [])
  })
}))

vi.mock('@renderer/hooks/useNotesQuery', () => ({
  useActiveNode: () => ({ activeNode: null })
}))

vi.mock('@renderer/components/command', () => ({
  CommandContextMenu: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@renderer/components/FileTree', () => ({
  FileTree: () => null
}))

vi.mock('@renderer/components/HighlightText', () => ({
  default: () => null
}))

vi.mock('@renderer/pages/notes/NotesSidebarHeader', () => ({
  default: ({
    onToggleSearchView,
    onSetSearchKeyword
  }: {
    onToggleSearchView: () => void
    onSetSearchKeyword: (keyword: string) => void
  }) => (
    <div>
      <button type="button" onClick={onToggleSearchView}>
        toggle search
      </button>
      <input aria-label="search input" onChange={(e) => onSetSearchKeyword(e.target.value)} />
    </div>
  )
}))

vi.mock('../NotesSearchMatchList', () => ({
  default: () => null
}))

import NotesSidebar from '../NotesSidebar'

const defaultProps = {
  onCreateFolder: vi.fn(),
  onCreateNote: vi.fn(),
  onSelectNode: vi.fn(),
  onDeleteNode: vi.fn(),
  onRenameNode: vi.fn(),
  onToggleExpanded: vi.fn(),
  onToggleStar: vi.fn(),
  onMoveNode: vi.fn(),
  onSortNodes: vi.fn(),
  onUploadFiles: vi.fn(),
  notesTree: [],
  sortType: 'sort_a2z' as NotesSortType,
  selectedFolderId: null
}

/** Open the search view and type a keyword, as a user starting a search would. */
const startSearch = (keyword: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'toggle search' }))
  fireEvent.change(screen.getByLabelText('search input'), { target: { value: keyword } })
}

describe('NotesSidebar import hint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the markdown file picker when the import hint is clicked', () => {
    render(<NotesSidebar {...defaultProps} />)

    fireEvent.click(screen.getByText('notes.drop_markdown_hint'))

    expect(mocks.handleSelectFiles).toHaveBeenCalledOnce()
    expect(mocks.handleSelectFolder).not.toHaveBeenCalled()
  })
})

describe('NotesSidebar search status row', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isSearching = false
    mocks.results = []
    mocks.resultsKeyword = ''
    mocks.stats = { total: 0, nameMatches: 0, contentMatches: 0 }
  })

  it('shows no status row before the first scan of a query completes', () => {
    render(<NotesSidebar {...defaultProps} />)
    startSearch('foo')

    // resultsKeyword is still '' — nothing has completed yet.
    expect(screen.queryByText('notes.search.no_results')).not.toBeInTheDocument()
    expect(screen.queryByText('notes.search.found_results')).not.toBeInTheDocument()
    expect(screen.queryByTitle('common.refresh')).not.toBeInTheDocument()
  })

  it('keeps the refresh control reachable when a completed query has zero hits', () => {
    const { rerender } = render(<NotesSidebar {...defaultProps} />)
    startSearch('foo')

    // The scan completed and found nothing. An external edit could add the first
    // hit later, so the user still needs a way to re-run the query.
    // (The changed selectedFolderId defeats the component's memo — with the search
    // hook mocked, nothing else forces a re-render.)
    mocks.resultsKeyword = 'foo'
    rerender(<NotesSidebar {...defaultProps} selectedFolderId="rerender-bump" />)

    expect(screen.getByText('notes.search.no_results')).toBeInTheDocument()
    mocks.search.mockClear()
    fireEvent.click(screen.getByTitle('common.refresh'))
    expect(mocks.search).toHaveBeenCalledWith([], 'foo')
  })

  it('shows occurrence stats and the refresh control for a query with hits', () => {
    const { rerender } = render(<NotesSidebar {...defaultProps} />)
    startSearch('foo')

    mocks.resultsKeyword = 'foo'
    mocks.stats = { total: 3, nameMatches: 1, contentMatches: 2 }
    rerender(<NotesSidebar {...defaultProps} selectedFolderId="rerender-bump" />)

    expect(screen.getByText('notes.search.found_results')).toBeInTheDocument()
    expect(screen.queryByText('notes.search.no_results')).not.toBeInTheDocument()
    expect(screen.getByTitle('common.refresh')).toBeInTheDocument()
  })
})
