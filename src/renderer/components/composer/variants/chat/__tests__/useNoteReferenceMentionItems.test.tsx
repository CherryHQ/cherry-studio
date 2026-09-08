import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { act, renderHook } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useNoteReferenceMentionItems } from '../useNoteReferenceMentionItems'

const mocks = vi.hoisted(() => ({
  listDirectory: vi.fn(),
  resolveNotesPath: vi.fn(),
  notesPath: '/configured-notes'
}))

vi.mock('@renderer/hooks/useNotesSettings', () => ({
  useNotesSettings: () => ({ notesPath: mocks.notesPath })
}))

vi.mock('@renderer/services/NotesService', () => ({
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
    mocks.notesPath = '/configured-notes'
    mocks.resolveNotesPath.mockResolvedValue({ path: '/notes', isFallback: true })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          listDirectory: mocks.listDirectory
        }
      }
    })
  })

  it('searches the resolved Notes directory and exposes matching Markdown notes', async () => {
    mocks.listDirectory.mockResolvedValue(['/notes/projects/Launch plan.md', '/notes/assets/launch.png'])
    const setFiles = vi.fn()
    const { result } = renderHook(() => useNoteReferenceMentionItems({ files: [], setFiles }))

    const items = await result.current.getItems({ query: 'launch', editor: createEditor().editor })

    expect(mocks.resolveNotesPath).toHaveBeenCalledWith('/configured-notes')
    expect(mocks.listDirectory).toHaveBeenCalledWith(
      '/notes',
      expect.objectContaining({
        recursive: true,
        includeFiles: true,
        includeDirectories: false,
        searchPattern: '.'
      })
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      label: 'Launch plan',
      description: '/projects/Launch plan'
    })
  })

  it('inserts a selected note through the existing file token and attachment flow', async () => {
    mocks.listDirectory.mockResolvedValue(['/notes/Daily.md'])
    let files: ComposerAttachment[] = []
    const setFiles = vi.fn((updater: React.SetStateAction<ComposerAttachment[]>) => {
      files = typeof updater === 'function' ? updater(files) : updater
    })
    const { editor, insertComposerToken, run } = createEditor()
    const { result } = renderHook(() => useNoteReferenceMentionItems({ files, setFiles }))
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
