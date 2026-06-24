// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FileContextMenuActions } from '../FileContextMenu'
import type { FileItem } from '../fileDisplay'
import { FileList } from '../FileList'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const file: FileItem = {
  id: 'file-1',
  name: 'report.md',
  format: 'md',
  size: '1 KB',
  sizeBytes: 1024,
  createdAt: '2026-06-24 10:00',
  updatedAt: '2026-06-24 10:00',
  trashed: false,
  origin: 'internal',
  type: 'text'
}

const menuActions: FileContextMenuActions = {
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onRestore: vi.fn(),
  onShowInFolder: vi.fn()
}

function fileListProps(renamingId: string | null): ComponentProps<typeof FileList> {
  return {
    files: [file],
    selectedIds: new Set(),
    onSelect: vi.fn(),
    onContextMenuOpen: vi.fn(),
    onOpen: vi.fn(),
    isTrash: false,
    menuActions,
    sortKey: 'name',
    sortDir: 'asc',
    onSort: vi.fn(),
    renamingId,
    onRenameConfirm: vi.fn(),
    onRenameCancel: vi.fn()
  }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('FileList', () => {
  it('focuses the inline rename input when rename is triggered', () => {
    vi.useFakeTimers()

    const { rerender } = render(<FileList {...fileListProps(null)} />)

    rerender(<FileList {...fileListProps(file.id)} />)

    const input = screen.getByDisplayValue(file.name) as HTMLInputElement

    act(() => {
      vi.runOnlyPendingTimers()
    })

    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('report'.length)
  })
})
