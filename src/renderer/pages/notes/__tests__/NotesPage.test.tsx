import type * as NotesQueryModule from '@renderer/hooks/useNotesQuery'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const noteNode = {
    id: '/notes/note.md',
    name: 'note',
    type: 'file' as const,
    treePath: '/note',
    externalPath: '/notes/note.md',
    createdAt: '',
    updatedAt: '',
    isStarred: false
  }

  return {
    currentContent: 'saved content',
    richEditorContent: 'edited rich content',
    sourceEditorContent: 'edited source content',
    mountedEditor: 'source',
    editorReady: vi.fn(),
    getNode: vi.fn(),
    invalidateFileContent: vi.fn(),
    ipcRequest: vi.fn(),
    noteByPath: new Map(),
    patchNode: vi.fn(),
    removePath: vi.fn(),
    rewritePath: vi.fn(),
    setActiveFilePath: vi.fn(),
    settings: {
      isFullWidth: true,
      fontFamily: 'default',
      fontSize: 16,
      showTableOfContents: false,
      defaultViewMode: 'edit',
      defaultEditMode: 'source',
      showTabStatus: true
    },
    sortTree: vi.fn((nodes) => nodes),
    t: (key: string) => key,
    toggleShowWorkspace: vi.fn(),
    treeRoot: {},
    updateNotesPath: vi.fn(),
    updateSettings: vi.fn(),
    updateSortType: vi.fn(),
    noteNode
  }
})

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: mocks.t })
}))

vi.mock('i18next', () => {
  const i18n = {
    t: mocks.t,
    use: vi.fn(() => i18n),
    init: vi.fn(() => Promise.resolve(i18n))
  }

  return {
    default: i18n,
    t: i18n.t
  }
})

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const withoutDomOnlyProps = (props: Record<string, unknown>) => {
    const domProps = { ...props }
    delete domProps.active
    delete domProps.onOpenChange
    return domProps
  }
  const passthrough =
    (tag: string) =>
    ({ children, ...props }: any) =>
      React.createElement(tag, withoutDomOnlyProps(props), children)

  return {
    Breadcrumb: passthrough('nav'),
    BreadcrumbItem: passthrough('span'),
    BreadcrumbList: passthrough('div'),
    BreadcrumbSeparator: passthrough('span'),
    Button: ({ children, onPress, ...props }: any) =>
      React.createElement('button', { ...withoutDomOnlyProps(props), onClick: onPress ?? props.onClick }, children),
    Input: ({ ref, ...props }: any & { ref?: React.RefObject<HTMLInputElement | null> }) =>
      React.createElement('input', { ...props, ref }),
    MenuDivider: (props: any) => React.createElement('hr', props),
    MenuItem: ({ icon, label, onClick, suffix, ...props }: any) =>
      React.createElement('button', { ...withoutDomOnlyProps(props), type: 'button', onClick }, icon, label, suffix),
    MenuList: passthrough('div'),
    Popover: passthrough('div'),
    PopoverContent: passthrough('div'),
    PopoverTrigger: ({ children }: any) => React.createElement('div', { 'data-testid': 'popover-trigger' }, children),
    RowFlex: passthrough('div'),
    Tooltip: ({ children }: any) => children
  }
})

vi.mock('@renderer/components/Popups/GeneralPopup', () => ({
  default: {
    show: vi.fn(),
    hide: vi.fn()
  }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: mocks.ipcRequest,
    on: vi.fn()
  }
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useCache: () => ['/notes/note.md', mocks.setActiveFilePath]
}))

vi.mock('@renderer/hooks/useShowWorkspace', () => ({
  useShowWorkspace: () => ({
    showWorkspace: false,
    toggleShowWorkspace: mocks.toggleShowWorkspace
  })
}))

vi.mock('@renderer/hooks/useNotesSettings', () => ({
  useNotesSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.updateSettings,
    notesPath: '/notes',
    updateNotesPath: mocks.updateNotesPath,
    sortType: 'sort_a2z',
    updateSortType: mocks.updateSortType
  })
}))

vi.mock('@renderer/hooks/useDirectoryTree', () => ({
  useDirectoryTree: () => ({
    root: mocks.treeRoot,
    isLoading: false,
    error: null,
    version: 0,
    treeId: null,
    getNode: mocks.getNode
  })
}))

vi.mock('@renderer/hooks/useNote', () => ({
  useNote: () => ({
    noteByPath: mocks.noteByPath,
    patchNode: mocks.patchNode,
    removePath: mocks.removePath,
    rewritePath: mocks.rewritePath
  })
}))

vi.mock('@renderer/hooks/useNotesQuery', async (importOriginal) => {
  const actual = await importOriginal<typeof NotesQueryModule>()

  return {
    ...actual,
    useFileContent: () => ({ data: mocks.currentContent, error: undefined }),
    useFileContentSync: () => ({ invalidateFileContent: mocks.invalidateFileContent })
  }
})

vi.mock('@renderer/services/NotesService', () => ({
  projectNotesTree: vi.fn(() => [mocks.noteNode]),
  sortTree: mocks.sortTree,
  addDir: vi.fn(),
  addNote: vi.fn(),
  delNode: vi.fn(),
  renameNode: vi.fn(),
  resolveNotesPath: vi.fn(async (path: string) => ({ path, isFallback: false })),
  uploadNotes: vi.fn()
}))

vi.mock('../NotesEditor', async () => {
  const React = await import('react')

  function MockNotesEditor({ codeEditorRef, editorRef, onMarkdownChange }: any) {
    React.useEffect(() => {
      codeEditorRef.current =
        mocks.mountedEditor === 'rich'
          ? null
          : {
              getContent: () => mocks.sourceEditorContent,
              scrollToLine: vi.fn()
            }
      editorRef.current =
        mocks.mountedEditor === 'source'
          ? null
          : {
              getContent: () => mocks.richEditorContent,
              getMarkdown: () => mocks.richEditorContent,
              setMarkdown: (content: string) => {
                mocks.richEditorContent = content
              },
              scrollToLine: vi.fn()
            }
      if (mocks.mountedEditor !== 'rich') {
        onMarkdownChange(mocks.sourceEditorContent)
      } else {
        onMarkdownChange(mocks.richEditorContent)
      }
      mocks.editorReady()

      return () => {
        codeEditorRef.current = null
        editorRef.current = null
      }
    }, [codeEditorRef, editorRef, onMarkdownChange])

    return React.createElement('div', { 'data-testid': 'notes-editor' })
  }

  return {
    default: MockNotesEditor
  }
})

vi.mock('../NotesSettings', () => ({
  default: () => null
}))

vi.mock('../NotesSidebar', () => ({
  default: () => null
}))

import NotesPage from '../NotesPage'

describe('NotesPage print payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.currentContent = 'saved content'
    mocks.richEditorContent = 'edited rich content'
    mocks.sourceEditorContent = 'edited source content'
    mocks.mountedEditor = 'source'
    mocks.settings.defaultEditMode = 'source'
    mocks.settings.defaultViewMode = 'edit'
    mocks.ipcRequest.mockResolvedValue(true)

    Object.assign(window, {
      toast: {
        success: vi.fn(),
        warning: vi.fn(),
        error: vi.fn()
      },
      api: {
        getAppInfo: vi.fn().mockResolvedValue({ notesPath: '/notes' }),
        setEnableSpellCheck: vi.fn().mockResolvedValue(undefined),
        export: {
          toWord: vi.fn().mockResolvedValue(undefined)
        },
        file: {
          write: vi.fn().mockResolvedValue(undefined),
          listDirectory: vi.fn().mockResolvedValue([])
        },
        tree: {
          onMutation: vi.fn(() => vi.fn()),
          dispose: vi.fn().mockResolvedValue(undefined)
        }
      }
    })
  })

  it.each([
    ['notes.exportToPDF', 'note.export_pdf'],
    ['notes.print', 'note.print']
  ])('uses current source editor content for %s', async (label, route) => {
    render(<NotesPage />)

    await waitFor(() => expect(screen.getByDisplayValue('note')).toBeInTheDocument())
    await waitFor(() => expect(mocks.editorReady).toHaveBeenCalled())

    fireEvent.click(screen.getByTestId('popover-trigger'))
    fireEvent.click(screen.getByRole('button', { name: label }))

    await waitFor(() => {
      expect(mocks.ipcRequest).toHaveBeenCalledWith(route, {
        title: 'note',
        markdown: mocks.sourceEditorContent,
        sourcePath: '/notes/note.md'
      })
    })
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith(
      route,
      expect.objectContaining({ markdown: mocks.currentContent })
    )
  })

  it.each([
    ['notes.exportToPDF', 'note.export_pdf'],
    ['notes.print', 'note.print']
  ])(
    'uses current rich editor markdown for %s when source is the default but rich editor is mounted',
    async (label, route) => {
      mocks.settings.defaultEditMode = 'source'
      mocks.mountedEditor = 'rich'
      const editedRichContent = 'edited rich content after switching view'

      render(<NotesPage />)

      await waitFor(() => expect(screen.getByDisplayValue('note')).toBeInTheDocument())
      await waitFor(() => expect(mocks.editorReady).toHaveBeenCalled())

      mocks.richEditorContent = editedRichContent
      fireEvent.click(screen.getByTestId('popover-trigger'))
      fireEvent.click(screen.getByRole('button', { name: label }))

      await waitFor(() => {
        expect(mocks.ipcRequest).toHaveBeenCalledWith(route, {
          title: 'note',
          markdown: editedRichContent,
          sourcePath: '/notes/note.md'
        })
      })
      expect(mocks.ipcRequest).not.toHaveBeenCalledWith(
        route,
        expect.objectContaining({ markdown: mocks.currentContent })
      )
    }
  )

  it('does not export stale saved content when the rich editor has been cleared', async () => {
    mocks.settings.defaultEditMode = 'preview'
    mocks.mountedEditor = 'rich'
    mocks.richEditorContent = mocks.currentContent

    render(<NotesPage />)

    await waitFor(() => expect(screen.getByDisplayValue('note')).toBeInTheDocument())
    await waitFor(() => expect(mocks.editorReady).toHaveBeenCalled())

    mocks.richEditorContent = ''
    fireEvent.click(screen.getByTestId('popover-trigger'))
    fireEvent.click(screen.getByRole('button', { name: 'notes.exportToPDF' }))

    await waitFor(() => {
      expect(window.toast.warning).toHaveBeenCalledWith('notes.no_content_to_export')
    })
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
  })
})
