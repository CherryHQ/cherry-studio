import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ComposerPanelSymbol } from '@renderer/components/composer/quickPanel'
import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import type { NotesTreeNode } from '@renderer/types/note'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'

const mocks = vi.hoisted(() => ({
  directoryTreeCalls: [] as Array<{ path: string | undefined; options: unknown }>,
  error: null as Error | null,
  files: [] as ComposerAttachment[],
  isLoading: false,
  open: vi.fn(),
  openRoute: vi.fn(),
  projectNotesTree: vi.fn(),
  registerLaunchers: vi.fn<(launchers: ComposerToolLauncher[], footerActions?: unknown[]) => () => void>(
    () => () => undefined
  ),
  resolveNotesPath: vi.fn(),
  root: null as object | null,
  notesPath: '/notes',
  setFiles: vi.fn(),
  symbol: 'notes',
  updateList: vi.fn(),
  version: 0
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openRoute: (...args: unknown[]) => mocks.openRoute(...args)
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  useQuickPanel: () => ({
    isVisible: true,
    symbol: mocks.symbol,
    updateList: mocks.updateList
  })
}))

vi.mock('@renderer/hooks/useDirectoryTree', () => ({
  useDirectoryTree: (path: string | undefined, options: unknown) => {
    mocks.directoryTreeCalls.push({ path, options })
    return {
      root: mocks.root,
      isLoading: mocks.isLoading,
      error: mocks.error,
      version: mocks.version
    }
  }
}))

vi.mock('@renderer/hooks/useNotesSettings', () => ({
  useNotesSettings: () => ({ notesPath: mocks.notesPath })
}))

vi.mock('@renderer/services/NotesService', () => ({
  projectNotesTree: (...args: unknown[]) => mocks.projectNotesTree(...args),
  resolveNotesPath: (...args: unknown[]) => mocks.resolveNotesPath(...args)
}))

import { NoteReferenceComposerRuntime, noteToComposerAttachment } from '../noteReferenceTool'

const t = ((key: string) => key) as any

const note = (overrides: Partial<NotesTreeNode> = {}): NotesTreeNode => ({
  id: 'note',
  name: 'Daily note',
  type: 'file',
  treePath: 'journal/Daily note.md',
  externalPath: '/notes/journal/Daily note.md',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  ...overrides
})

function runtimeView() {
  return (
    <NoteReferenceComposerRuntime
      context={
        {
          actions: { setFiles: mocks.setFiles },
          launcher: { registerLaunchers: mocks.registerLaunchers },
          state: { files: mocks.files },
          t
        } as any
      }
    />
  )
}

function renderRuntime() {
  return render(runtimeView())
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('noteReferenceTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.directoryTreeCalls = []
    mocks.error = null
    mocks.files = []
    mocks.isLoading = false
    mocks.notesPath = '/notes'
    mocks.root = null
    mocks.symbol = ComposerPanelSymbol.Notes
    mocks.version = 0
    mocks.resolveNotesPath.mockReset()
    mocks.resolveNotesPath.mockImplementation(async (path: string) => ({ path, isFallback: false }))
    mocks.setFiles.mockImplementation((updater) => {
      mocks.files = typeof updater === 'function' ? updater(mocks.files) : updater
    })
  })

  it('registers a root launcher and lazily opens a notes panel', async () => {
    mocks.root = {}
    mocks.projectNotesTree.mockReturnValue([
      note({ id: 'folder', name: 'journal', type: 'folder', children: [note()] })
    ])
    renderRuntime()

    expect(mocks.directoryTreeCalls.at(-1)).toMatchObject({ path: undefined })
    const launcher = mocks.registerLaunchers.mock.calls.at(-1)?.[0][0]
    expect(launcher).toMatchObject({
      id: 'note-reference',
      kind: 'panel',
      sources: ['root-panel'],
      panelSymbol: ComposerPanelSymbol.Notes
    })

    act(() => {
      launcher?.action?.({ quickPanel: { open: mocks.open }, source: 'root-panel' } as any)
    })

    expect(mocks.open).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: ComposerPanelSymbol.Notes
      })
    )
    expect(mocks.open.mock.calls.at(-1)?.[0]).not.toHaveProperty('footerActions')
    const footerAction = mocks.registerLaunchers.mock.calls.at(-1)?.[1]?.[0] as { action: () => void }
    await act(async () => footerAction.action())
    expect(mocks.openRoute).toHaveBeenCalledWith('/app/notes')
    await waitFor(() => expect(mocks.directoryTreeCalls.at(-1)).toMatchObject({ path: '/notes' }))
    expect(mocks.directoryTreeCalls.at(-1)?.options).toMatchObject({ extensions: ['.md'] })
    await waitFor(() => {
      const items = mocks.updateList.mock.calls.at(-1)?.[0]
      expect(items).toEqual([
        expect.objectContaining({
          label: 'Daily note',
          description: 'journal/Daily note.md'
        })
      ])
    })
  })

  it('adds a selected note through the existing composer attachment state', async () => {
    mocks.root = {}
    mocks.projectNotesTree.mockReturnValue([note()])
    renderRuntime()

    const launcher = mocks.registerLaunchers.mock.calls.at(-1)?.[0][0]
    act(() => {
      launcher?.action?.({ quickPanel: { open: mocks.open }, source: 'root-panel' } as any)
    })

    await waitFor(() => expect(mocks.updateList.mock.calls.at(-1)?.[0][0]?.action).toBeTypeOf('function'))
    const item = mocks.updateList.mock.calls.at(-1)?.[0][0]
    void act(() => item.action?.({} as any))

    expect(mocks.files).toEqual([
      expect.objectContaining({
        name: 'Daily note.md',
        origin_name: 'Daily note.md',
        path: '/notes/journal/Daily note.md',
        ext: '.md',
        size: 0,
        type: 'text',
        fileTokenSourceId: expect.any(String)
      })
    ])
  })

  it.each([
    { configuredPath: '', resolvedPath: '/default-notes' },
    { configuredPath: '/stale-notes', resolvedPath: '/default-notes' }
  ])('scans the resolved notes path for $configuredPath', async ({ configuredPath, resolvedPath }) => {
    mocks.notesPath = configuredPath
    mocks.root = {}
    mocks.resolveNotesPath.mockResolvedValue({ path: resolvedPath, isFallback: true })
    mocks.projectNotesTree.mockReturnValue([note({ externalPath: `${resolvedPath}/Daily note.md` })])
    renderRuntime()

    const launcher = mocks.registerLaunchers.mock.calls.at(-1)?.[0][0]
    act(() => {
      launcher?.action?.({ quickPanel: { open: mocks.open }, source: 'root-panel' } as any)
    })

    await waitFor(() => expect(mocks.resolveNotesPath).toHaveBeenCalledWith(configuredPath))
    await waitFor(() => expect(mocks.directoryTreeCalls.at(-1)).toMatchObject({ path: resolvedPath }))
    await waitFor(() => expect(mocks.projectNotesTree).toHaveBeenCalledWith(mocks.root, resolvedPath))
  })

  it('reloads root search when the configured notes directory changes', async () => {
    const nextPath = deferred<{ path: string; isFallback: boolean }>()
    mocks.notesPath = '/first-notes'
    mocks.symbol = ComposerPanelSymbol.Root
    mocks.resolveNotesPath
      .mockResolvedValueOnce({ path: '/first-notes', isFallback: false })
      .mockReturnValueOnce(nextPath.promise)

    const view = renderRuntime()
    await waitFor(() => expect(mocks.directoryTreeCalls.at(-1)).toMatchObject({ path: '/first-notes' }))

    mocks.notesPath = '/second-notes'
    view.rerender(runtimeView())

    await waitFor(() => expect(mocks.resolveNotesPath).toHaveBeenCalledWith('/second-notes'))
    expect(mocks.directoryTreeCalls.at(-1)).toMatchObject({ path: undefined })

    nextPath.resolve({ path: '/second-notes', isFallback: false })
    await waitFor(() => expect(mocks.directoryTreeCalls.at(-1)).toMatchObject({ path: '/second-notes' }))
  })

  it('ignores stale root-search path resolutions', async () => {
    const firstPath = deferred<{ path: string; isFallback: boolean }>()
    const secondPath = deferred<{ path: string; isFallback: boolean }>()
    mocks.symbol = ComposerPanelSymbol.Root
    mocks.resolveNotesPath.mockReturnValueOnce(firstPath.promise).mockReturnValueOnce(secondPath.promise)

    const view = renderRuntime()
    await waitFor(() => expect(mocks.resolveNotesPath).toHaveBeenCalledWith('/notes'))

    mocks.notesPath = '/latest-notes'
    view.rerender(runtimeView())
    await waitFor(() => expect(mocks.resolveNotesPath).toHaveBeenCalledWith('/latest-notes'))

    secondPath.resolve({ path: '/latest-notes', isFallback: false })
    await waitFor(() => expect(mocks.directoryTreeCalls.at(-1)).toMatchObject({ path: '/latest-notes' }))

    firstPath.resolve({ path: '/notes', isFallback: false })
    await act(async () => undefined)
    expect(mocks.directoryTreeCalls.at(-1)).toMatchObject({ path: '/latest-notes' })
  })

  it('does not add a note that is already attached', async () => {
    const selectedNote = note()
    mocks.files = [noteToComposerAttachment(selectedNote)]
    mocks.root = {}
    mocks.projectNotesTree.mockReturnValue([selectedNote])
    renderRuntime()

    const launcher = mocks.registerLaunchers.mock.calls.at(-1)?.[0][0]
    act(() => {
      launcher?.action?.({ quickPanel: { open: mocks.open }, source: 'root-panel' } as any)
    })

    await waitFor(() => {
      const item = mocks.updateList.mock.calls.at(-1)?.[0][0]
      expect(item).toMatchObject({ isSelected: true, disabled: true })
    })
  })
})
