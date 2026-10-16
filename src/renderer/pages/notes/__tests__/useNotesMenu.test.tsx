import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import type { NotesTreeNode } from '@renderer/types/note'
import type { DocumentFormat } from '@shared/types/documentConversion'

import { useNotesMenu } from '../hooks/useNotesMenu'

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

function getDocumentExportAction(menu: ReturnType<typeof useNotesMenu>, note: NotesTreeNode, format: DocumentFormat) {
  const submenu = menu.getMenuItems(note).find((item) => item.type === 'submenu' && item.id === 'notes.export')
  if (!submenu || submenu.type !== 'submenu') throw new Error('Export menu not found')
  const item = submenu.children.find((item) => item.type === 'item' && item.id === `notes.export.${format}`)
  if (!item || item.type !== 'item') throw new Error(`${format} export action not found`)
  return item.onSelect
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useNotesMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('feature.notes.path', '/notes')
  })

  it('exports the selected note from the latest draft and reads it from disk after selecting another note', async () => {
    const savedContent = '# Saved content before editing'
    Object.assign(window.api.file, { readExternal: vi.fn().mockResolvedValue(savedContent) })
    vi.mocked(ipcApi.request).mockResolvedValue(null)
    const { result, rerender } = renderHook(
      ({ activeNode, getCurrentNoteContent }) =>
        useNotesMenu({
          renamingNodeIds: new Set(),
          onCreateNote: vi.fn(),
          onCreateFolder: vi.fn(),
          onRenameNode: vi.fn(),
          onToggleStar: vi.fn(),
          onDeleteNode: vi.fn(),
          onSelectNode: vi.fn(),
          handleStartEdit: vi.fn(),
          handleAutoRename: vi.fn(),
          activeNode,
          getCurrentNoteContent
        }),
      { initialProps: { activeNode: node, getCurrentNoteContent: () => '# Earlier draft' } }
    )

    rerender({ activeNode: node, getCurrentNoteContent: () => '# Unsaved edits after the last render' })
    act(() => getDocumentExportAction(result.current, node, 'pdf')())

    const exportInput = {
      format: 'pdf',
      defaultName: node.name,
      sourcePath: node.externalPath,
      assetRoot: '/notes'
    }
    await waitFor(() => {
      expect(vi.mocked(ipcApi.request).mock.calls).toEqual([
        ['export.document.convert_and_save', { ...exportInput, markdown: '# Unsaved edits after the last render' }]
      ])
    })

    rerender({
      activeNode: { ...node, id: 'note-2', externalPath: '/notes/Other.md' },
      getCurrentNoteContent: () => '# Other note draft'
    })
    act(() => getDocumentExportAction(result.current, node, 'pdf')())

    await waitFor(() => {
      expect(vi.mocked(ipcApi.request).mock.calls).toEqual([
        ['export.document.convert_and_save', { ...exportInput, markdown: '# Unsaved edits after the last render' }],
        ['export.document.convert_and_save', { ...exportInput, markdown: savedContent }]
      ])
    })
  })

  it('preserves an empty selected draft instead of exporting the old file contents', async () => {
    Object.assign(window.api.file, { readExternal: vi.fn().mockResolvedValue('# Deleted from the editor') })
    vi.mocked(ipcApi.request).mockResolvedValueOnce(null)
    const { result } = renderHook(() =>
      useNotesMenu({
        renamingNodeIds: new Set(),
        onCreateNote: vi.fn(),
        onCreateFolder: vi.fn(),
        onRenameNode: vi.fn(),
        onToggleStar: vi.fn(),
        onDeleteNode: vi.fn(),
        onSelectNode: vi.fn(),
        handleStartEdit: vi.fn(),
        handleAutoRename: vi.fn(),
        activeNode: node,
        getCurrentNoteContent: () => ''
      })
    )

    act(() => getDocumentExportAction(result.current, node, 'pdf')())

    await waitFor(() => {
      expect(vi.mocked(ipcApi.request).mock.calls).toEqual([
        [
          'export.document.convert_and_save',
          { markdown: '', format: 'pdf', defaultName: node.name, sourcePath: node.externalPath, assetRoot: '/notes' }
        ]
      ])
    })
  })

  it('exports an inactive nested note from disk with the note library as its image boundary', async () => {
    const markdown = '# Example\n\n![Chart](../images/chart.png)'
    const readExternal = vi.fn().mockResolvedValue(markdown)
    Object.assign(window.api.file, { readExternal })
    vi.mocked(ipcApi.request).mockResolvedValueOnce(null)
    const nestedNote = { ...node, externalPath: '/notes/reports/Example.md' }
    const { result } = renderHook(() =>
      useNotesMenu({
        renamingNodeIds: new Set(),
        onCreateNote: vi.fn(),
        onCreateFolder: vi.fn(),
        onRenameNode: vi.fn(),
        onToggleStar: vi.fn(),
        onDeleteNode: vi.fn(),
        onSelectNode: vi.fn(),
        handleStartEdit: vi.fn(),
        handleAutoRename: vi.fn(),
        activeNode: { ...node, id: 'active-note' },
        getCurrentNoteContent: () => '# Unrelated active draft'
      })
    )

    act(() => getDocumentExportAction(result.current, nestedNote, 'pptx')())

    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('export.document.convert_and_save', {
        markdown,
        format: 'pptx',
        defaultName: 'Example',
        sourcePath: '/notes/reports/Example.md',
        assetRoot: '/notes'
      })
    )
  })

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
