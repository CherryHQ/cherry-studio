import { toast } from '@renderer/services/toast'
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
    sessionStatus: 'ready' as string,
    sessionIsDirty: false,
    sessionIsSaving: false,
    sessionSaveError: undefined as Error | undefined,
    sessionDraft: 'saved content',
    currentContent: 'saved content',
    richEditorContent: 'edited rich content',
    sourceEditorContent: 'edited source content',
    mountedEditor: 'source',
    editorReady: vi.fn(),
    getNode: vi.fn(),
    setDraft: vi.fn(),
    discardSession: vi.fn(),
    flushSession: vi.fn().mockResolvedValue(undefined),
    reloadSession: vi.fn().mockResolvedValue(undefined),
    notifyExternalChange: vi.fn(),
    ipcRequest: vi.fn(),
    commandHandlers: new Map<string, { handler: () => void | Promise<void>; enabled: boolean }>(),
    isActiveTab: true,
    showWorkspace: false,
    printShortcutLabel: 'Ctrl+P',
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
    Tooltip: ({ children }: any) => children,
    ConfirmDialog: ({
      open,
      title,
      description,
      confirmText,
      confirmLoading,
      cancelText,
      onConfirm,
      onOpenChange
    }: any) =>
      open
        ? React.createElement(
            'div',
            { role: 'dialog' },
            React.createElement('div', null, title),
            React.createElement('div', null, description),
            React.createElement('button', { type: 'button', onClick: () => onOpenChange?.(false) }, cancelText),
            React.createElement(
              'button',
              { type: 'button', disabled: confirmLoading, onClick: () => onConfirm?.() },
              confirmText
            )
          )
        : null
  }
})

vi.mock('@renderer/components/popups/ContentPopup', () => ({
  default: {
    show: vi.fn()
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
    showWorkspace: mocks.showWorkspace,
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

vi.mock('@renderer/hooks/tab', () => ({
  useIsActiveTab: () => mocks.isActiveTab
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: (command: string, handler: () => void | Promise<void>, options?: { enabled?: boolean }) => {
    mocks.commandHandlers.set(command, {
      handler,
      enabled: options?.enabled !== false
    })
  },
  useResolvedCommand: (command: string) => ({
    id: command,
    label: command,
    enabled: true,
    shortcutLabel: command === 'app.print' ? mocks.printShortcutLabel : '',
    execute: vi.fn()
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

vi.mock('@renderer/hooks/useFileEditSession', () => ({
  useFileEditSession: () => ({
    status: mocks.sessionStatus,
    savedContent: mocks.sessionStatus === 'ready' ? mocks.currentContent : '',
    draft: mocks.sessionStatus === 'ready' ? mocks.sessionDraft : '',
    isDirty: mocks.sessionIsDirty,
    isSaving: mocks.sessionIsSaving,
    conflict: false,
    saveError: mocks.sessionSaveError,
    unsupportedReason: mocks.sessionStatus === 'unsupported' ? 'size' : undefined,
    setDraft: mocks.setDraft,
    discard: mocks.discardSession,
    reload: mocks.reloadSession,
    flush: mocks.flushSession,
    notifyExternalChange: mocks.notifyExternalChange
  })
}))

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

  function MockNotesEditor({ codeEditorRef, currentContent, editorRef, onMarkdownChange }: any) {
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

    return React.createElement('div', { 'data-current-content': currentContent, 'data-testid': 'notes-editor' })
  }

  return {
    default: MockNotesEditor
  }
})

vi.mock('../NotesSettings', () => ({
  default: () => null
}))

vi.mock('../NotesSidebar', () => ({
  default: ({ onSelectNode }: { onSelectNode: (node: typeof mocks.noteNode) => void }) => (
    <>
      <button type="button" onClick={() => onSelectNode(mocks.noteNode)}>
        select current note
      </button>
      <button
        type="button"
        onClick={() =>
          onSelectNode({
            ...mocks.noteNode,
            id: '/notes/other.md',
            name: 'other',
            treePath: '/other',
            externalPath: '/notes/other.md'
          })
        }>
        select other note
      </button>
    </>
  )
}))

import NotesPage from '../NotesPage'

describe('NotesPage print payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sessionStatus = 'ready'
    mocks.sessionIsDirty = false
    mocks.sessionIsSaving = false
    mocks.sessionSaveError = undefined
    mocks.sessionDraft = 'saved content'
    mocks.currentContent = 'saved content'
    mocks.richEditorContent = 'edited rich content'
    mocks.sourceEditorContent = 'edited source content'
    mocks.mountedEditor = 'source'
    mocks.settings.defaultEditMode = 'source'
    mocks.settings.defaultViewMode = 'edit'
    mocks.ipcRequest.mockImplementation((route: string) => {
      if (route === 'app.get_info') return Promise.resolve({ notesPath: '/notes' })
      if (route === 'app.set_spell_check_enabled') return Promise.resolve(undefined)
      return Promise.resolve(true)
    })
    mocks.commandHandlers.clear()
    mocks.isActiveTab = true
    mocks.showWorkspace = false
    mocks.printShortcutLabel = 'Ctrl+P'

    Object.assign(window, {
      api: {
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
    ['notes.exportToPDF', 'print.export_pdf'],
    ['notes.print', 'print.print']
  ])('uses current source editor content for %s', async (label, route) => {
    render(<NotesPage />)

    await waitFor(() => expect(screen.getByDisplayValue('note')).toBeInTheDocument())
    await waitFor(() => expect(mocks.editorReady).toHaveBeenCalled())

    fireEvent.click(screen.getByTestId('popover-trigger'))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }))

    await waitFor(() => {
      expect(mocks.ipcRequest).toHaveBeenCalledWith(route, {
        title: 'note',
        markdown: mocks.sourceEditorContent,
        sourcePath: '/notes/note.md'
      })
    })
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith(
      route,
      expect.objectContaining({
        markdown: mocks.currentContent
      })
    )
  })

  it.each([
    ['notes.exportToPDF', 'print.export_pdf'],
    ['notes.print', 'print.print']
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
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }))

      await waitFor(() => {
        expect(mocks.ipcRequest).toHaveBeenCalledWith(route, {
          title: 'note',
          markdown: editedRichContent,
          sourcePath: '/notes/note.md'
        })
      })
      expect(mocks.ipcRequest).not.toHaveBeenCalledWith(
        route,
        expect.objectContaining({
          markdown: mocks.currentContent
        })
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
      expect(toast.warning).toHaveBeenCalledWith('notes.no_content_to_export')
    })
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
  })

  it('routes the app.print command through the current source editor content', async () => {
    render(<NotesPage />)

    await waitFor(() => expect(screen.getByDisplayValue('note')).toBeInTheDocument())
    await waitFor(() => expect(mocks.editorReady).toHaveBeenCalled())

    let command: { handler: () => void | Promise<void>; enabled: boolean } | undefined
    await waitFor(() => {
      command = mocks.commandHandlers.get('app.print')
      expect(command?.enabled).toBe(true)
    })

    await command?.handler()

    await waitFor(() => {
      expect(mocks.ipcRequest).toHaveBeenCalledWith('print.print', {
        title: 'note',
        markdown: mocks.sourceEditorContent,
        sourcePath: '/notes/note.md'
      })
    })
  })

  it('keeps the app.print command disabled for inactive tabs', async () => {
    mocks.isActiveTab = false

    render(<NotesPage />)

    await waitFor(() => expect(screen.getByDisplayValue('note')).toBeInTheDocument())
    await waitFor(() => {
      expect(mocks.commandHandlers.get('app.print')?.enabled).toBe(false)
    })
  })

  it('shows the resolved print shortcut next to the print menu item', async () => {
    mocks.printShortcutLabel = '⌘P'

    render(<NotesPage />)

    await waitFor(() => expect(screen.getByDisplayValue('note')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('popover-trigger'))

    expect(screen.getByRole('button', { name: /notes\.print/ })).toHaveTextContent('⌘P')
  })

  it('blocks editing and surfaces a load failure for unsupported note files', async () => {
    // Oversize / non-UTF-8 / mixed-line-ending notes must not render as an
    // editable blank document (regression guard for the unsupported status).
    mocks.sessionStatus = 'unsupported'

    render(<NotesPage />)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('notes.load_failed'))
  })

  it('prompts before leaving a dirty note and keeps the draft when cancelled', async () => {
    mocks.sessionIsDirty = true
    mocks.sessionDraft = 'unsaved draft'
    mocks.showWorkspace = true

    render(<NotesPage />)

    await waitFor(() => expect(screen.getByDisplayValue('note')).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('notes-editor')).toHaveAttribute('data-current-content', 'unsaved draft')
    fireEvent.click(screen.getByRole('button', { name: 'select other note' }))

    expect(mocks.setActiveFilePath).not.toHaveBeenCalledWith('/notes/other.md')
    expect(screen.getByRole('dialog')).toHaveTextContent('notes.leave.title')
    expect(screen.getByRole('dialog')).toHaveTextContent('notes.leave.description')

    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.discardSession).not.toHaveBeenCalled()
    expect(mocks.flushSession).not.toHaveBeenCalled()
    expect(mocks.setActiveFilePath).not.toHaveBeenCalledWith('/notes/other.md')
  })

  it('does not prompt or discard when reselecting the current dirty note', async () => {
    mocks.sessionIsDirty = true
    mocks.sessionDraft = 'unsaved draft'
    mocks.showWorkspace = true

    render(<NotesPage />)

    await waitFor(() => expect(screen.getByDisplayValue('note')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'select current note' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.discardSession).not.toHaveBeenCalled()
    expect(mocks.flushSession).not.toHaveBeenCalled()
    expect(mocks.setActiveFilePath).not.toHaveBeenCalledWith('/notes/note.md')
  })

  it('waits for an in-flight note save before allowing discard and navigation', async () => {
    mocks.sessionIsDirty = true
    mocks.sessionIsSaving = true
    mocks.sessionDraft = 'unsaved draft'
    mocks.showWorkspace = true
    const { rerender } = render(<NotesPage />)

    await waitFor(() => expect(screen.getByDisplayValue('note')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'select other note' }))

    expect(screen.getByRole('button', { name: 'notes.leave.discard_and_continue' })).toBeDisabled()
    expect(mocks.discardSession).not.toHaveBeenCalled()

    mocks.sessionIsSaving = false
    rerender(<NotesPage />)
    fireEvent.click(screen.getByRole('button', { name: 'notes.leave.discard_and_continue' }))

    expect(mocks.discardSession).toHaveBeenCalledOnce()
    expect(mocks.setActiveFilePath).toHaveBeenCalledWith('/notes/other.md')
  })

  it('discards a dirty note before continuing the pending navigation', async () => {
    mocks.sessionIsDirty = true
    mocks.sessionDraft = 'unsaved draft'
    mocks.showWorkspace = true

    render(<NotesPage />)

    await waitFor(() => expect(screen.getByDisplayValue('note')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'select other note' }))
    fireEvent.click(screen.getByRole('button', { name: 'notes.leave.discard_and_continue' }))

    expect(mocks.discardSession).toHaveBeenCalledOnce()
    expect(mocks.setActiveFilePath).toHaveBeenCalledWith('/notes/other.md')
    expect(mocks.discardSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setActiveFilePath.mock.invocationCallOrder[0]
    )
    expect(mocks.flushSession).not.toHaveBeenCalled()
  })
})
