// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FileContextMenuActions } from '../FileContextMenu'
import type { FileItem } from '../fileDisplay'
import { formatFileSize, getFormatLabel } from '../fileDisplay'
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
    onOpen: vi.fn(),
    onSelectAll: vi.fn(),
    visibleSelectionState: false,
    onDelete: vi.fn(),
    onRestore: vi.fn(),
    onRename: vi.fn(),
    onShowInFolder: vi.fn(),
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

describe('fileDisplay helpers', () => {
  it('formats file sizes at unit and precision boundaries', () => {
    expect(formatFileSize(null)).toBe('—')
    expect(formatFileSize(undefined)).toBe('—')
    expect(formatFileSize(Number.NaN)).toBe('—')
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(1023)).toBe('1023 B')
    expect(formatFileSize(1024)).toBe('1.0 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(10 * 1024)).toBe('10 KB')
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
  })

  it('uses known format labels and uppercases unknown extensions', () => {
    expect(getFormatLabel('')).toBe('—')
    expect(getFormatLabel('md')).toBe('Markdown')
    expect(getFormatLabel('xls')).toBe('Excel')
    expect(getFormatLabel('xlsx')).toBe('Excel')
    expect(getFormatLabel('custom')).toBe('CUSTOM')
  })
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

  it('selects files only through checkboxes', () => {
    const onSelect = vi.fn()

    render(<FileList {...fileListProps(null)} onSelect={onSelect} />)

    fireEvent.click(screen.getByText(file.name))
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('checkbox', { name: 'files.select_file' }))
    expect(onSelect).toHaveBeenCalledWith(file.id)
  })

  it('opens files through the existing action', () => {
    const onOpen = vi.fn()

    render(<FileList {...fileListProps(null)} onOpen={onOpen} />)

    fireEvent.click(screen.getByRole('button', { name: 'files.open' }))

    expect(onOpen).toHaveBeenCalledWith(file)
  })

  it('opens a file on a single row click', () => {
    const onOpen = vi.fn()

    render(<FileList {...fileListProps(null)} onOpen={onOpen} />)

    fireEvent.click(screen.getByText(file.name))

    expect(onOpen).toHaveBeenCalledWith(file)
  })

  it('does not open when clicking the checkbox column', () => {
    const onOpen = vi.fn()

    render(<FileList {...fileListProps(null)} onOpen={onOpen} />)

    const checkbox = screen.getByRole('checkbox', { name: 'files.select_file' })
    fireEvent.click(checkbox.parentElement as HTMLElement)

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('does not open a missing file on a row click', () => {
    const onOpen = vi.fn()
    const missingFile: FileItem = { ...file, id: 'missing-file', isMissing: true }

    render(<FileList {...fileListProps(null)} files={[missingFile]} onOpen={onOpen} />)

    fireEvent.click(screen.getByText(missingFile.name))

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('shows the row show-in-folder action for active files', () => {
    const externalFile: FileItem = {
      ...file,
      id: 'external-file',
      origin: 'external'
    }

    const { rerender } = render(<FileList {...fileListProps(null)} files={[file]} />)

    expect(screen.getByRole('button', { name: 'files.show_in_folder' })).toBeInTheDocument()

    rerender(<FileList {...fileListProps(null)} files={[externalFile]} />)

    expect(screen.getByRole('button', { name: 'files.show_in_folder' })).toBeInTheDocument()
  })

  it('uses remove-from-library wording for external row deletes', () => {
    const externalFile: FileItem = {
      ...file,
      id: 'external-file',
      origin: 'external'
    }

    const { rerender } = render(<FileList {...fileListProps(null)} files={[file]} />)

    expect(screen.getByRole('button', { name: 'files.delete.label' })).toBeInTheDocument()

    rerender(<FileList {...fileListProps(null)} files={[externalFile]} />)

    expect(screen.getByRole('button', { name: 'files.remove_from_library' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'files.delete.label' })).not.toBeInTheDocument()
  })

  it('hides invalid row actions for missing files', () => {
    const missingExternalFile: FileItem = {
      ...file,
      id: 'missing-external-file',
      origin: 'external',
      isMissing: true
    }

    render(<FileList {...fileListProps(null)} files={[missingExternalFile]} />)

    expect(screen.queryByRole('button', { name: 'files.open' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'files.rename' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'files.show_in_folder' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'files.remove_from_library' })).toBeInTheDocument()
  })
})
