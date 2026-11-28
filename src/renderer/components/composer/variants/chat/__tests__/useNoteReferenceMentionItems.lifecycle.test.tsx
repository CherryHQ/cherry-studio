import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CreateTreeIpcResult, SerializedTreeNode } from '@shared/utils/file'

import type { ComposerSuggestionItem } from '../../../quickPanel'
import { useNoteReferenceMentionItems } from '../useNoteReferenceMentionItems'

const mocks = vi.hoisted(() => ({ create: vi.fn(), dispose: vi.fn(), unsubscribe: vi.fn() }))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (route: string, input: { treeId: string }) => {
      if (route === 'app.get_info') return Promise.resolve({ notesPath: '/default-notes' })
      if (route === 'file.validate_notes_directory') return Promise.resolve(true)
      if (route === 'file.tree.create') return mocks.create(input)
      if (route === 'file.tree.activate') return Promise.resolve(true)
      if (route === 'file.tree.dispose') return mocks.dispose(input.treeId)
      throw new Error(`Unexpected route ${route}`)
    },
    on: () => mocks.unsubscribe
  }
}))

function snapshot(treeId: string, name: string): CreateTreeIpcResult {
  const file: SerializedTreeNode = { kind: 'file', path: `/configured-notes/${name}.md`, basename: `${name}.md` }
  return {
    treeId,
    revision: 0,
    snapshot: {
      kind: 'directory',
      path: '/configured-notes',
      basename: 'configured-notes',
      children: { [file.basename]: file }
    }
  }
}

const args = { query: '', editor: {} as Editor }

describe('Notes mention directory lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('feature.notes.path', '/configured-notes')
    mocks.dispose.mockResolvedValue(undefined)
    mocks.create.mockResolvedValue(snapshot('first-tree', 'First'))
  })

  afterEach(() => {
    cleanup()
  })

  it('releases the native watcher on exit and discovers new notes when reopened', async () => {
    const { result } = renderHook(() => useNoteReferenceMentionItems({ files: [], setFiles: vi.fn() }))
    expect(mocks.create).not.toHaveBeenCalled()
    let items!: Promise<ComposerSuggestionItem[]>
    act(() => {
      items = result.current.getItems(args)
    })
    await expect(items).resolves.toEqual([expect.objectContaining({ label: 'First' })])

    act(() => result.current.onExit())
    await waitFor(() => expect(mocks.dispose).toHaveBeenCalledWith('first-tree'))
    expect(mocks.unsubscribe).toHaveBeenCalled()

    mocks.create.mockResolvedValue(snapshot('second-tree', 'Created while closed'))
    act(() => {
      items = result.current.getItems(args)
    })
    await expect(items).resolves.toEqual([expect.objectContaining({ label: 'Created while closed' })])
  })

  it('settles a closed pending request and disposes a late tree without replacing the reopened results', async () => {
    let finish!: (tree: CreateTreeIpcResult) => void
    mocks.create.mockReturnValueOnce(
      new Promise<CreateTreeIpcResult>((resolve) => {
        finish = resolve
      })
    )
    const { result } = renderHook(() => useNoteReferenceMentionItems({ files: [], setFiles: vi.fn() }))
    let oldItems!: Promise<ComposerSuggestionItem[]>
    act(() => {
      oldItems = result.current.getItems(args)
    })
    await waitFor(() => expect(mocks.create).toHaveBeenCalled())

    act(() => result.current.onExit())
    await expect(oldItems).resolves.toEqual([])
    mocks.create.mockResolvedValue(snapshot('reopened-tree', 'Current'))
    let newItems!: Promise<ComposerSuggestionItem[]>
    act(() => {
      newItems = result.current.getItems(args)
    })
    await expect(newItems).resolves.toEqual([expect.objectContaining({ label: 'Current' })])

    await act(async () => finish(snapshot('late-tree', 'Stale')))
    await waitFor(() => expect(mocks.dispose).toHaveBeenCalledWith('late-tree'))
    await expect(result.current.getItems(args)).resolves.toEqual([expect.objectContaining({ label: 'Current' })])
    expect(mocks.dispose).not.toHaveBeenCalledWith('reopened-tree')
  })

  it('refreshes the same path when close and reopen happen before React commits', async () => {
    const { result } = renderHook(() => useNoteReferenceMentionItems({ files: [], setFiles: vi.fn() }))
    let items!: Promise<ComposerSuggestionItem[]>
    act(() => {
      items = result.current.getItems(args)
    })
    await expect(items).resolves.toEqual([expect.objectContaining({ label: 'First' })])

    mocks.create.mockResolvedValue(snapshot('fresh-tree', 'Fresh'))
    act(() => {
      result.current.onExit()
      items = result.current.getItems(args)
    })
    await expect(items).resolves.toEqual([expect.objectContaining({ label: 'Fresh' })])
    expect(mocks.dispose).toHaveBeenCalledWith('first-tree')
  })
})
