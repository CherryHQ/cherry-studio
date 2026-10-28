import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { addNote } from '@renderer/services/NotesService'
import { toast } from '@renderer/services/toast'
import type { RenameNote } from '@renderer/types/note'

import type { NotesEditorLoading } from '../NotesEditor'

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
    renameNote: undefined as RenameNote | undefined,
    finishMutation: vi.fn(),
    prepareMutation: vi.fn(),
    renameEntry: vi.fn(),
    sessionStatus: String('ready'),
    sessionIsDirty: false,
    sessionIsSaving: false,
    sessionSaveError: undefined as Error | undefined,
    sessionConflict: false,
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
    keepDraftSession: vi.fn().mockResolvedValue(undefined),
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
    treeVersion: 0,
    treeIsLoading: false,
    projectedNodes: [noteNode],
    updateNotesPath: vi.fn(),
    updateSettings: vi.fn(),
    updateSortType: vi.fn(),
    activeFilePath: ['/notes/note.md'].at(0),
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
    Skeleton: (props: any) => React.createElement('div', { ...props, 'data-testid': 'skeleton' }),
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
              {
                type: 'button',
                disabled: confirmLoading,
                // Mirrors the real ConfirmDialog: close after onConfirm unless it returns false.
                onClick: () =>
                  Promise.resolve(onConfirm?.()).then((result) => {
                    if (result !== false) onOpenChange?.(false)
                  })
              },
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
    on: vi.fn(() => vi.fn())
  }
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useCache: () => [mocks.activeFilePath, mocks.setActiveFilePath]
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
    isLoading: mocks.treeIsLoading,
    error: null,
    version: mocks.treeVersion,
    treeId: 'notes-tree',
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
    sessionId: mocks.activeFilePath,
    documentEpoch: 1,
    readOnly: false,
    prepareMutation: mocks.prepareMutation,
    savedContent: mocks.sessionStatus === 'ready' ? mocks.currentContent : '',
    draft: mocks.sessionStatus === 'ready' ? mocks.sessionDraft : '',
    isDirty: mocks.sessionIsDirty,
    isSaving: mocks.sessionIsSaving,
    conflict: mocks.sessionConflict,
    saveError: mocks.sessionSaveError,
    metadataRecoveryPending: false,
    unsupportedReason: mocks.sessionStatus === 'unsupported' ? 'size' : undefined,
    setDraft: mocks.setDraft,
    discard: mocks.discardSession,
    reload: mocks.reloadSession,
    keepDraft: mocks.keepDraftSession,
    flush: mocks.flushSession,
    notifyExternalChange: mocks.notifyExternalChange
  })
}))

vi.mock('@renderer/services/NotesService', () => ({
  projectNotesTree: vi.fn(() => mocks.projectedNodes),
  sortTree: mocks.sortTree,
  addDir: vi.fn(),
  addNote: vi.fn(),
  delNode: vi.fn(),
  renameNode: mocks.renameEntry,
  resolveNotesPath: vi.fn(async (path: string) => ({ path, isFallback: false })),
  uploadNotes: vi.fn()
}))

vi.mock('../NotesEditor', async (importOriginal) => {
  const original = await importOriginal<{ NotesEditorLoading: typeof NotesEditorLoading }>()
  const React = await import('react')

  function MockNotesEditor({
    activeNodeId,
    codeEditorRef,
    currentContent,
    editorRef,
    onCreateNote,
    onMarkdownChange
  }: any) {
    React.useEffect(() => {
      if (!activeNodeId) {
        return
      }
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
    }, [activeNodeId, codeEditorRef, editorRef, onMarkdownChange])

    if (!activeNodeId) {
      return React.createElement(
        'div',
        { 'data-testid': 'notes-editor' },
        onCreateNote ? React.createElement('button', { type: 'button', onClick: onCreateNote }, 'notes.new_note') : null
      )
    }

    return React.createElement('div', {
      'data-active-node-id': activeNodeId,
      'data-current-content': currentContent,
      'data-testid': 'notes-editor'
    })
  }

  // Keep the real loading surface: the page's ready-gate contract is asserted against it.
  return { ...original, default: MockNotesEditor }
})

vi.mock('../NotesSettings', () => ({
  default: () => null
}))

vi.mock('../NotesSidebar', () => ({
  default: ({
    onSelectNode,
    onRenameNode
  }: {
    onSelectNode: (node: typeof mocks.noteNode) => void
    onRenameNode: RenameNote
  }) => {
    mocks.renameNote = onRenameNode
    return (
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
  }
}))

import NotesPage from '../NotesPage'

async function renderReadyNotesPage() {
  const view = render(<NotesPage />)
  await waitFor(() => expect(screen.getByDisplayValue('note')).toBeInTheDocument())
  await waitFor(() => expect(mocks.editorReady).toHaveBeenCalled())
  return view
}

describe('NotesPage print payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.finishMutation.mockReset().mockResolvedValue(undefined)
    mocks.prepareMutation.mockReset().mockImplementation(async () => ({ finish: mocks.finishMutation }))
    mocks.renameEntry.mockReset().mockResolvedValue({ path: '/notes/Roadmap.md', name: 'Roadmap' })
    mocks.rewritePath.mockReset().mockResolvedValue(undefined)
    mocks.renameNote = undefined
    mocks.sessionStatus = 'ready'
    mocks.sessionIsDirty = false
    mocks.sessionIsSaving = false
    mocks.sessionSaveError = undefined
    mocks.sessionConflict = false
    mocks.sessionDraft = 'saved content'
    mocks.currentContent = 'saved content'
    mocks.richEditorContent = 'edited rich content'
    mocks.sourceEditorContent = 'edited source content'
    mocks.mountedEditor = 'source'
    mocks.settings.defaultEditMode = 'source'
    mocks.settings.defaultViewMode = 'edit'
    mocks.ipcRequest.mockImplementation((route: string) => {
      if (route === 'app.get_info') return Promise.resolve({ notesPath: '/notes' })
      return Promise.resolve(true)
    })
    mocks.commandHandlers.clear()
    mocks.isActiveTab = true
    mocks.showWorkspace = false
    mocks.printShortcutLabel = 'Ctrl+P'
    mocks.treeVersion = 0
    mocks.treeIsLoading = false
    mocks.projectedNodes = [mocks.noteNode]
    mocks.activeFilePath = '/notes/note.md'

    Object.assign(window, {
      api: {
        export: {
          toWord: vi.fn().mockResolvedValue(undefined)
        },
        file: {
          write: vi.fn().mockResolvedValue(undefined),
          listDirectory: vi.fn().mockResolvedValue([]),
          move: vi.fn().mockResolvedValue(undefined)
        }
      }
    })
  })

  it.each([
    ['notes.exportToPDF', 'print.export_pdf'],
    ['notes.print', 'print.print']
  ])('uses current source editor content for %s', async (label, route) => {
    await renderReadyNotesPage()

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

  it('opens a requested saved note once its directory-tree entry arrives', async () => {
    const onNoteOpened = vi.fn()
    const { rerender } = render(<NotesPage notePath="/notes/Topic (1).md" onNoteOpened={onNoteOpened} />)
    await waitFor(() => expect(mocks.editorReady).toHaveBeenCalled())
    expect(mocks.setActiveFilePath).not.toHaveBeenCalled()

    mocks.projectedNodes = [
      mocks.noteNode,
      { ...mocks.noteNode, id: '/notes/Topic (1).md', externalPath: '/notes/Topic (1).md', name: 'Topic (1)' }
    ]
    mocks.treeVersion += 1
    rerender(<NotesPage notePath="/notes/Topic (1).md" onNoteOpened={onNoteOpened} />)
    await waitFor(() => expect(mocks.setActiveFilePath).toHaveBeenCalledWith('/notes/Topic (1).md'))
    expect(onNoteOpened).toHaveBeenCalled()
    expect(mocks.discardSession).not.toHaveBeenCalled()
  })

  it('does not open an arbitrary path outside the notes tree', async () => {
    render(<NotesPage notePath="/outside/private.md" />)
    await waitFor(() => expect(mocks.editorReady).toHaveBeenCalled())
    expect(mocks.setActiveFilePath).not.toHaveBeenCalled()
  })

  it('cancels an unavailable note request when the user selects a different note', async () => {
    const user = userEvent.setup()
    mocks.showWorkspace = true
    const onNoteOpened = vi.fn()
    render(<NotesPage notePath="/notes/missing.md" onNoteOpened={onNoteOpened} />)
    await waitFor(() => expect(mocks.editorReady).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'select current note' }))
    expect(onNoteOpened).toHaveBeenCalled()
    expect(mocks.setActiveFilePath).not.toHaveBeenCalled()
  })

  it('applies a new note request to an already mounted page after composition ends', async () => {
    const { rerender } = await renderReadyNotesPage()
    const editor = screen.getByTestId('notes-editor')
    fireEvent.compositionStart(editor)
    mocks.projectedNodes = [
      mocks.noteNode,
      { ...mocks.noteNode, id: '/notes/other.md', externalPath: '/notes/other.md', name: 'other' }
    ]
    mocks.treeVersion += 1
    rerender(<NotesPage notePath="/notes/other.md" />)
    expect(mocks.setActiveFilePath).not.toHaveBeenCalled()
    fireEvent.compositionEnd(editor)
    await waitFor(() => expect(mocks.setActiveFilePath).toHaveBeenCalledWith('/notes/other.md'))
    expect(mocks.discardSession).not.toHaveBeenCalled()
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

      await renderReadyNotesPage()

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

    await renderReadyNotesPage()

    mocks.richEditorContent = ''
    fireEvent.click(screen.getByTestId('popover-trigger'))
    fireEvent.click(screen.getByRole('button', { name: 'notes.exportToPDF' }))

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith('notes.no_content_to_export')
    })
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
  })

  it('does not retain stale rich editor content when the ready draft becomes empty', async () => {
    mocks.settings.defaultEditMode = 'preview'
    mocks.mountedEditor = 'rich'
    mocks.sessionDraft = 'previous note content'
    mocks.richEditorContent = mocks.sessionDraft
    const { rerender } = await renderReadyNotesPage()

    mocks.sessionDraft = ''
    mocks.richEditorContent = ''
    rerender(<NotesPage />)
    await waitFor(() => expect(screen.getByTestId('notes-editor')).toHaveAttribute('data-current-content', ''))

    fireEvent.click(screen.getByTestId('popover-trigger'))
    fireEvent.click(screen.getByRole('button', { name: 'notes.exportToPDF' }))

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith('notes.no_content_to_export')
    })
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith('print.export_pdf', expect.anything())
  })

  it('routes the app.print command through the current source editor content', async () => {
    await renderReadyNotesPage()

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

  it('does not mount the note editor until the file session is ready', async () => {
    mocks.sessionStatus = 'loading'
    const { rerender } = render(<NotesPage />)

    expect(await screen.findByRole('status')).toHaveTextContent('common.loading')
    expect(screen.getAllByTestId('skeleton')).toHaveLength(3)
    expect(screen.queryByTestId('notes-editor')).not.toBeInTheDocument()
    expect(mocks.editorReady).not.toHaveBeenCalled()
    expect(mocks.setDraft).not.toHaveBeenCalled()

    mocks.sessionStatus = 'ready'
    rerender(<NotesPage />)

    await waitFor(() => expect(screen.getByTestId('notes-editor')).toBeInTheDocument())
  })

  it.each(['saving', 'failed'])('switches a dirty note while its save is %s without discarding', async (state) => {
    mocks.sessionIsDirty = true
    mocks.sessionIsSaving = state === 'saving'
    mocks.sessionSaveError = state === 'failed' ? new Error('disk full') : undefined
    mocks.sessionDraft = 'unsaved draft'
    mocks.showWorkspace = true
    mocks.flushSession.mockImplementation(() => new Promise(() => {}))
    const user = userEvent.setup()
    await renderReadyNotesPage()
    await user.click(screen.getByRole('button', { name: 'select other note' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.setActiveFilePath).toHaveBeenCalledWith('/notes/other.md')
    expect(mocks.discardSession).not.toHaveBeenCalled()
  })

  it('keeps the composing editor mounted until composition ends', async () => {
    mocks.showWorkspace = true
    const user = userEvent.setup()
    await renderReadyNotesPage()
    const editor = screen.getByTestId('notes-editor')
    fireEvent.compositionStart(editor)
    await user.click(screen.getByRole('button', { name: 'select other note' }))
    expect(mocks.setActiveFilePath).not.toHaveBeenCalledWith('/notes/other.md')
    fireEvent.compositionEnd(editor)
    await user.click(screen.getByRole('button', { name: 'select other note' }))
    expect(mocks.setActiveFilePath).toHaveBeenCalledWith('/notes/other.md')
  })

  it('does not prompt or discard when reselecting the current dirty note', async () => {
    mocks.sessionIsDirty = true
    mocks.sessionDraft = 'unsaved draft'
    mocks.showWorkspace = true

    await renderReadyNotesPage()
    fireEvent.click(screen.getByRole('button', { name: 'select current note' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.discardSession).not.toHaveBeenCalled()
    expect(mocks.flushSession).not.toHaveBeenCalled()
    expect(mocks.setActiveFilePath).not.toHaveBeenCalledWith('/notes/note.md')
  })

  it('keeps the draft when the conflict dialog is dismissed without reloading', async () => {
    mocks.sessionConflict = true

    await renderReadyNotesPage()
    expect(screen.getByRole('dialog')).toHaveTextContent('notes.conflict.title')

    fireEvent.click(screen.getByRole('button', { name: 'notes.conflict.keep_draft' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.keepDraftSession).toHaveBeenCalledOnce()
    expect(mocks.reloadSession).not.toHaveBeenCalled()
  })

  it('reopens the conflict dialog when keeping the draft fails', async () => {
    mocks.sessionConflict = true
    const failure = new Error('baseline read failed')
    mocks.keepDraftSession.mockImplementationOnce(() => {
      // The manager publishes the failure on the session snapshot.
      mocks.sessionSaveError = failure
      return Promise.reject(failure)
    })

    await renderReadyNotesPage()
    fireEvent.click(screen.getByRole('button', { name: 'notes.conflict.keep_draft' }))
    expect(mocks.keepDraftSession).toHaveBeenCalledOnce()

    // The failure rerender still reports the conflict, which re-opens the dialog.
    await act(async () => {})
    expect(screen.getByRole('dialog')).toHaveTextContent('notes.conflict.title')
  })

  it('reloads the disk version without keeping the draft when reload is chosen', async () => {
    mocks.sessionConflict = true

    await renderReadyNotesPage()
    fireEvent.click(screen.getByRole('button', { name: 'notes.conflict.reload' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.reloadSession).toHaveBeenCalledOnce()
    // Flush the microtask that would run a stray keepDraft if the guard regressed.
    await act(async () => {})
    expect(mocks.keepDraftSession).not.toHaveBeenCalled()
  })

  it('keeps a dirty draft accessible when the active file is removed', async () => {
    mocks.sessionIsDirty = true
    mocks.sessionDraft = 'recoverable draft'
    const { rerender } = await renderReadyNotesPage()

    expect(screen.getByTestId('notes-editor')).toHaveAttribute('data-current-content', 'recoverable draft')

    mocks.projectedNodes = []
    mocks.treeVersion += 1
    rerender(<NotesPage />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('notes.file_removed_draft'))
    expect(screen.getByRole('alert')).toHaveTextContent('notes.file_removed_draft')
    expect(screen.getByTestId('notes-editor')).toHaveAttribute('data-active-node-id', '/notes/note.md')
    expect(screen.getByTestId('notes-editor')).toHaveAttribute('data-current-content', 'recoverable draft')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('notes-editor')).toHaveAttribute('data-current-content', 'recoverable draft')
    expect(mocks.discardSession).not.toHaveBeenCalled()
    expect(mocks.setActiveFilePath).not.toHaveBeenCalledWith(undefined)
  })

  it('creates an untitled note from the empty editor using the canonical create flow', async () => {
    mocks.activeFilePath = undefined
    mocks.projectedNodes = []
    vi.mocked(addNote).mockResolvedValue({ path: '/notes/Untitled Note.md', name: 'Untitled Note' })

    render(<NotesPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'notes.new_note' }))

    await waitFor(() => {
      expect(addNote).toHaveBeenCalledWith('notes.untitled_note', '', '/notes')
    })
    await waitFor(() => {
      expect(mocks.setActiveFilePath).toHaveBeenCalledWith('/notes/Untitled Note.md')
    })
  })

  // Exercise the page callback itself so failures cannot be hidden by the entry-point hooks.
  async function rename(newName = 'Roadmap', nodeId = mocks.noteNode.id) {
    mocks.showWorkspace = true
    await renderReadyNotesPage()
    let outcome: Awaited<ReturnType<RenameNote>> | undefined
    await act(async () => {
      outcome = await mocks.renameNote!(nodeId, newName)
    })
    return outcome
  }

  it('returns the actual renamed stem only after cleanup and active-path updates settle', async () => {
    mocks.showWorkspace = true
    let finish!: () => void
    const cleanup = new Promise<void>((resolve) => {
      finish = resolve
    })
    mocks.finishMutation.mockReturnValue(cleanup)
    // The service may sanitize a manual name; the public result must use its actual stem.
    mocks.renameEntry.mockResolvedValue({ path: '/notes/Roadmap.md', name: 'Roadmap' })
    await renderReadyNotesPage()
    let settled = false
    let operation!: ReturnType<RenameNote>
    await act(async () => {
      operation = mocks.renameNote!(mocks.noteNode.id, 'Roadmap?')
      void operation.then(() => {
        settled = true
      })
    })
    expect(settled).toBe(false)
    expect(mocks.setActiveFilePath).not.toHaveBeenCalledWith('/notes/Roadmap.md')
    await act(async () => {
      finish()
      expect(await operation).toEqual({ ok: true, name: 'Roadmap' })
    })
    expect(mocks.setActiveFilePath).toHaveBeenCalledWith('/notes/Roadmap.md')
    expect(mocks.rewritePath).toHaveBeenCalledWith('/notes/note.md', '/notes/Roadmap.md', false)
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', { ok: false, reason: 'failed' }, 'notes.rename_failed'],
    ['unchanged', { ok: true, name: 'note' }, null]
  ] as const)('resolves a %s node without preparing a mutation', async (path, expected, error) => {
    expect(await rename('note', path === 'missing' ? '/notes/missing.md' : mocks.noteNode.id)).toEqual(expected)
    expect(mocks.prepareMutation).not.toHaveBeenCalled()
    expect(mocks.renameEntry).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledTimes(error ? 1 : 0)
    if (error) expect(toast.error).toHaveBeenCalledWith(error)
  })

  it.each(['missing', 'unchanged', 'metadata', 'cleanup'])(
    'releases rename suppression after %s so a watcher removal clears selection',
    async (path) => {
      mocks.showWorkspace = true
      const { rerender } = await renderReadyNotesPage()
      if (path === 'metadata') mocks.rewritePath.mockRejectedValue(new Error('metadata failed'))
      if (path === 'cleanup') mocks.finishMutation.mockRejectedValue(new Error('cleanup failed'))
      await act(async () => {
        await mocks.renameNote!(
          path === 'missing' ? '/notes/missing.md' : mocks.noteNode.id,
          path === 'unchanged' ? 'note' : 'Roadmap'
        )
      })
      mocks.projectedNodes = []
      mocks.treeVersion += 1
      rerender(<NotesPage />)
      await waitFor(() => expect(mocks.setActiveFilePath).toHaveBeenCalledWith(undefined))
    }
  )

  it.each([
    'collision',
    'preparation',
    'rename',
    'metadata',
    'metadata and rollback',
    'cleanup',
    'collision and cleanup',
    'metadata and cleanup'
  ])('resolves %s failure with exactly one owned error', async (failure) => {
    if (failure.includes('collision'))
      mocks.renameEntry.mockRejectedValue(new Error('Target name already exists: Roadmap'))
    if (failure === 'preparation') mocks.prepareMutation.mockRejectedValue(new Error('draft flush failed'))
    if (failure === 'rename') mocks.renameEntry.mockRejectedValue(new Error('permission denied'))
    if (failure.includes('metadata')) mocks.rewritePath.mockRejectedValue(new Error('metadata unavailable'))
    if (failure.includes('cleanup')) mocks.finishMutation.mockRejectedValue(new Error('cleanup failed'))
    if (failure === 'metadata and rollback') {
      vi.mocked(window.api.file.move).mockRejectedValue(new Error('rollback failed'))
    }
    const outcome = await rename()
    expect(outcome).toEqual({ ok: false, reason: failure.includes('collision') ? 'exists' : 'failed' })
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      failure.includes('collision')
        ? 'notes.target_name_exists'
        : failure.includes('metadata')
          ? 'notes.metadata_sync_failed'
          : 'notes.rename_failed'
    )
    expect(toast.success).not.toHaveBeenCalled()
    expect(mocks.setActiveFilePath).not.toHaveBeenCalledWith('/notes/Roadmap.md')
    if (failure !== 'preparation') expect(mocks.finishMutation).toHaveBeenCalled()
    if (failure.includes('metadata')) {
      expect(window.api.file.move).toHaveBeenCalledWith('/notes/Roadmap.md', '/notes/note.md')
    }
  })
})
