import type { NotesTreeNode } from '@renderer/types/note'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useNoteReferenceMentionItems } from '../useNoteReferenceMentionItems'

const mocks = vi.hoisted(() => ({
  directoryTreeCalls: [] as Array<{ path: string | undefined; options: unknown }>,
  directoryTreeError: null as Error | null,
  directoryTreeLoading: false,
  directoryTreeRoot: null as object | null,
  directoryTreeVersion: 0,
  projectNotesTree: vi.fn(),
  resolveNotesPath: vi.fn(),
  notesPath: '/configured-notes'
}))

vi.mock('@renderer/hooks/useDirectoryTree', () => ({
  useDirectoryTree: (path: string | undefined, options: unknown) => {
    mocks.directoryTreeCalls.push({ path, options })
    return {
      root: mocks.directoryTreeRoot,
      isLoading: mocks.directoryTreeLoading,
      error: mocks.directoryTreeError,
      version: mocks.directoryTreeVersion
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

const createEditor = () => {
  const run = vi.fn()
  const insertContent = vi.fn(() => ({ run }))
  const insertComposerToken = vi.fn(() => ({ insertContent, run }))
  const focus = vi.fn(() => ({ insertComposerToken }))
  const editor = { chain: vi.fn(() => ({ focus })) } as unknown as Editor
  return { editor, insertComposerToken, run }
}

describe('useNoteReferenceMentionItems', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.directoryTreeCalls = []
    mocks.directoryTreeError = null
    mocks.directoryTreeLoading = false
    mocks.directoryTreeRoot = {}
    mocks.directoryTreeVersion = 0
    mocks.notesPath = '/configured-notes'
    mocks.resolveNotesPath.mockResolvedValue({ path: '/notes', isFallback: true })
    mocks.projectNotesTree.mockReturnValue([])
  })

  it('searches deep Markdown notes from the canonical directory tree', async () => {
    const deepPath = `/notes/${Array.from({ length: 11 }, (_, index) => `level-${index + 1}`).join('/')}/Launch plan.md`
    const deepNote: NotesTreeNode = {
      id: deepPath,
      name: 'Launch plan',
      type: 'file',
      treePath: `/${deepPath.slice('/notes/'.length, -'.md'.length)}`,
      externalPath: deepPath,
      createdAt: '',
      updatedAt: ''
    }
    mocks.projectNotesTree.mockReturnValue([deepNote])
    const setFiles = vi.fn()
    const { result } = renderHook(() => useNoteReferenceMentionItems({ files: [], setFiles }))

    await waitFor(() => expect(mocks.directoryTreeCalls.some(({ path }) => path === '/notes')).toBe(true))
    const items = await result.current.getItems({ query: 'launch', editor: createEditor().editor })

    expect(mocks.resolveNotesPath).toHaveBeenCalledWith('/configured-notes')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      label: 'Launch plan',
      description: `/level-1/level-2/level-3/level-4/level-5/level-6/level-7/level-8/level-9/level-10/level-11/Launch plan`
    })
  })

  it('inserts a selected note through the existing file token and attachment flow', async () => {
    const note: NotesTreeNode = {
      id: '/notes/Daily.md',
      name: 'Daily',
      type: 'file',
      treePath: '/Daily',
      externalPath: '/notes/Daily.md',
      createdAt: '',
      updatedAt: ''
    }
    mocks.projectNotesTree.mockReturnValue([note])
    let files: ComposerAttachment[] = []
    const setFiles = vi.fn((updater: React.SetStateAction<ComposerAttachment[]>) => {
      files = typeof updater === 'function' ? updater(files) : updater
    })
    const { editor, insertComposerToken, run } = createEditor()
    const { result } = renderHook(() => useNoteReferenceMentionItems({ files, setFiles }))

    await waitFor(() => expect(mocks.directoryTreeCalls.some(({ path }) => path === '/notes')).toBe(true))
    const [item] = await result.current.getItems({ query: 'daily', editor })

    act(() => item.command({ editor, range: { from: 1, to: 7 }, item, query: 'daily' }))

    expect(insertComposerToken).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'file',
        label: 'Daily.md',
        payload: expect.objectContaining({ path: '/notes/Daily.md', type: 'text' })
      })
    )
    expect(run).toHaveBeenCalled()
    expect(files).toEqual([
      expect.objectContaining({
        path: '/notes/Daily.md',
        name: 'Daily.md',
        origin_name: 'Daily.md',
        ext: '.md',
        type: 'text'
      })
    ])
  })
})
