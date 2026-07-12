import type { NotesTreeNode } from '@renderer/types/note'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useNotesMenu } from '../useNotesMenu'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const note: NotesTreeNode = {
  id: 'note-1',
  name: 'Note.md',
  type: 'file',
  treePath: '/Note.md',
  externalPath: 'C:\\notes\\Note.md',
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z'
}

describe('useNotesMenu', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('starts inline rename after the context menu has closed', () => {
    const handleStartEdit = vi.fn()
    let deferredAction: FrameRequestCallback | undefined
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      deferredAction = callback
      return 1
    })

    const { result } = renderHook(() =>
      useNotesMenu({
        renamingNodeIds: new Set(),
        onCreateNote: vi.fn(),
        onCreateFolder: vi.fn(),
        onRenameNode: vi.fn(),
        onToggleStar: vi.fn(),
        onDeleteNode: vi.fn(),
        onSelectNode: vi.fn(),
        handleStartEdit,
        handleAutoRename: vi.fn(),
        activeNode: null
      })
    )

    const renameItem = result.current
      .getMenuItems(note)
      .find((item) => item.type === 'item' && item.id === 'notes.rename')
    if (!renameItem || renameItem.type !== 'item') throw new Error('Rename menu item not found')

    renameItem.onSelect()

    expect(handleStartEdit).not.toHaveBeenCalled()
    deferredAction?.(0)
    expect(handleStartEdit).toHaveBeenCalledWith(note)
  })
})
