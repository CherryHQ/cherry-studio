// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

import type { FileContextMenuActions } from '../FileContextMenu'
import type { FileItem } from '../fileDisplay'
import { formatFileSize } from '../fileDisplay'
import { FileList } from '../FileList'

type VirtualizerOptionsMock = {
  count: number
  estimateSize: () => number
  getItemKey?: (index: number) => string | number
}

const virtualizerMocks = vi.hoisted(() => ({
  scrollToIndex: vi.fn(),
  useVirtualizer: vi.fn((options: VirtualizerOptionsMock) => ({
    getTotalSize: () => options.count * options.estimateSize(),
    getVirtualItems: () =>
      options.count > 0
        ? [{ index: 0, key: options.getItemKey?.(0) ?? 0, size: options.estimateSize(), start: 0 }]
        : [],
    measureElement: vi.fn(),
    scrollToIndex: virtualizerMocks.scrollToIndex
  }))
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: virtualizerMocks.useVirtualizer
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      key === 'files.select_file_with_path' ? `Select ${values?.name} (${values?.path})` : key
  })
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
  isSidebarPinned: vi.fn(() => false),
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onShowInFolder: vi.fn(),
  onToggleSidebar: vi.fn()
}

function fileListProps(renamingId: string | null): ComponentProps<typeof FileList> {
  return {
    files: [file],
    selectedIds: new Set(),
    onSelect: vi.fn(),
    onOpen: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onShowInFolder: vi.fn(),
    menuActions,
    scrollRef: { current: document.createElement('div') },
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
})

describe('FileList', () => {
  it('disables row and context-menu deletion while a delete request is pending', async () => {
    const onDelete = vi.fn()
    const actions = { ...menuActions, onDelete }
    render(<FileList {...fileListProps(null)} onDelete={onDelete} menuActions={actions} deleteDisabled />)

    const rowDelete = screen.getByRole('button', { name: 'files.delete.label' })
    expect(rowDelete).toBeDisabled()
    fireEvent.contextMenu(screen.getByText('report.md'))
    const contextDelete = await screen.findByRole('menuitem', { name: 'files.delete.label' })
    expect(contextDelete).toHaveAttribute('data-disabled')

    fireEvent.click(rowDelete)
    fireEvent.click(contextDelete)
    expect(onDelete).not.toHaveBeenCalled()
  })

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

  it('forwards checkbox state and the Shift modifier without opening the row', async () => {
    const onSelect = vi.fn()
    const onOpen = vi.fn()
    const user = userEvent.setup()

    render(<FileList {...fileListProps(null)} onSelect={onSelect} onOpen={onOpen} />)

    const checkbox = screen.getByRole('checkbox', { name: 'files.select_file' })
    await user.keyboard('{Shift>}')
    await user.click(checkbox)
    await user.keyboard('{/Shift}')
    expect(onSelect).toHaveBeenCalledWith(file.id, true, true)
    expect(onOpen).not.toHaveBeenCalled()

    await user.click(screen.getByText(file.name))
    expect(onOpen).toHaveBeenCalledWith(file)
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('opens files through the existing action', () => {
    const onOpen = vi.fn()

    render(<FileList {...fileListProps(null)} onOpen={onOpen} />)

    const openButton = screen.getByRole('button', { name: 'files.open' })
    fireEvent.click(openButton)

    expect(onOpen).toHaveBeenCalledWith(file)
  })

  it('does not open a missing file on a row click', () => {
    const onOpen = vi.fn()
    const missingFile: FileItem = { ...file, id: 'missing-file', isMissing: true }

    render(<FileList {...fileListProps(null)} files={[missingFile]} onOpen={onOpen} />)

    fireEvent.click(screen.getByText(missingFile.name))

    expect(onOpen).not.toHaveBeenCalled()
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

  it('exposes distinct source paths for same-name files', () => {
    virtualizerMocks.useVirtualizer.mockImplementation((options: VirtualizerOptionsMock) => ({
      getTotalSize: () => options.count * options.estimateSize(),
      getVirtualItems: () =>
        Array.from({ length: options.count }, (_, index) => ({
          index,
          key: options.getItemKey?.(index) ?? index,
          size: options.estimateSize(),
          start: index * options.estimateSize()
        })),
      measureElement: vi.fn(),
      scrollToIndex: virtualizerMocks.scrollToIndex
    }))

    const first: FileItem = {
      ...file,
      id: 'file-migrated-a',
      name: 'migrated-image.png',
      format: 'png',
      type: 'image',
      sourcePath: '/Users/a/Pictures/migrated-image.png'
    }
    const second: FileItem = {
      ...first,
      id: 'file-migrated-b',
      sourcePath: '/Users/b/Downloads/migrated-image.png'
    }

    render(<FileList {...fileListProps(null)} files={[first, second]} />)

    const names = screen.getAllByText('migrated-image.png')
    expect(names).toHaveLength(2)
    expect(names[0]).toHaveAttribute('title', '/Users/a/Pictures/migrated-image.png')
    expect(names[1]).toHaveAttribute('title', '/Users/b/Downloads/migrated-image.png')
    expect(
      screen.getByRole('checkbox', {
        name: 'Select migrated-image.png (/Users/a/Pictures/migrated-image.png)'
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', {
        name: 'Select migrated-image.png (/Users/b/Downloads/migrated-image.png)'
      })
    ).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'files.select_file' })).not.toBeInTheDocument()
  })
})
