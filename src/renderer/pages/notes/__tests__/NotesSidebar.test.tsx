import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handleSelectFiles: vi.fn(),
  handleSelectFolder: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/components/command', () => ({
  CommandContextMenu: ({ children }: { children: React.ReactNode }) => children
}))

vi.mock('@renderer/components/FileTree', () => ({
  FileTree: () => null
}))

vi.mock('@renderer/hooks/useNotesQuery', () => ({
  useActiveNode: () => ({ activeNode: undefined })
}))

vi.mock('@renderer/pages/notes/NotesSidebarHeader', () => ({
  default: () => null
}))

vi.mock('../hooks/useFullTextSearch', () => ({
  useFullTextSearch: () => ({
    search: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
    isSearching: false,
    results: [],
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

describe('NotesSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the markdown file picker when the import hint is clicked', () => {
    render(
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
        notesTree={[]}
        sortType="sort_a2z"
      />
    )

    fireEvent.click(screen.getByText('notes.drop_markdown_hint'))

    expect(mocks.handleSelectFiles).toHaveBeenCalledOnce()
    expect(mocks.handleSelectFolder).not.toHaveBeenCalled()
  })
})
