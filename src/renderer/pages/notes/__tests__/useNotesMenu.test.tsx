import type { NotesTreeNode } from '@renderer/types/note'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useNotesMenu } from '../hooks/useNotesMenu'

vi.mock('@data/hooks/usePreference', () => ({
  useMultiplePreferences: () => [{}]
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: vi.fn() })
  }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn() }
}))

vi.mock('@renderer/services/popup', () => ({
  popup: { confirm: vi.fn() }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const node: NotesTreeNode = {
  id: 'note-1',
  name: 'Example',
  type: 'file',
  treePath: 'Example.md',
  externalPath: '/notes/Example.md',
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z'
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useNotesMenu', () => {
  it('starts inline rename after the context-menu focus restoration frame', () => {
    let frameCallback: FrameRequestCallback | undefined
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallback = callback
      return 1
    })
    const handleStartEdit = vi.fn()
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
        handleAutoRename: vi.fn()
      })
    )
    const renameItem = result.current
      .getMenuItems(node)
      .find((item) => item.type === 'item' && item.id === 'notes.rename')

    if (!renameItem || renameItem.type !== 'item') {
      throw new Error('Rename menu item not found')
    }

    act(() => renameItem.onSelect())
    expect(handleStartEdit).not.toHaveBeenCalled()

    act(() => frameCallback?.(0))
    expect(handleStartEdit).toHaveBeenCalledWith(node)
  })
})
