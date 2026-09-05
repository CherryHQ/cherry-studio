// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FileContextMenuActions } from '../FileContextMenu'
import type { FileItem } from '../fileDisplay'
import { FileGrid } from '../FileGrid'

type VirtualizerOptionsMock = {
  count: number
  estimateSize: () => number
  getItemKey?: (index: number) => string | number
}

const virtualizerMocks = vi.hoisted(() => ({
  measureElement: vi.fn(),
  useVirtualizer: vi.fn((options: VirtualizerOptionsMock) => ({
    getTotalSize: () => options.count * options.estimateSize(),
    getVirtualItems: () =>
      options.count > 0
        ? [{ index: 0, key: options.getItemKey?.(0) ?? 0, size: options.estimateSize(), start: 0 }]
        : [],
    measureElement: virtualizerMocks.measureElement
  }))
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: virtualizerMocks.useVirtualizer
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

// An image file without a preview URL renders the neutral placeholder surface.
const imageFile: FileItem = {
  id: 'image-1',
  name: 'photo.png',
  format: 'png',
  size: '1 KB',
  sizeBytes: 1024,
  createdAt: '2026-06-24 10:00',
  updatedAt: '2026-06-24 10:00',
  trashed: false,
  origin: 'internal',
  type: 'image'
}

const menuActions: FileContextMenuActions = {
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onRestore: vi.fn(),
  onShowInFolder: vi.fn()
}

function fileGridProps(files: FileItem[], width = 400): ComponentProps<typeof FileGrid> {
  const scrollElement = document.createElement('div')
  Object.defineProperty(scrollElement, 'clientWidth', { configurable: true, value: width })
  return {
    files,
    onOpen: vi.fn(),
    onDelete: vi.fn(),
    isTrash: false,
    menuActions,
    scrollRef: { current: scrollElement },
    onLayoutChange: vi.fn(),
    renamingId: null,
    onRenameConfirm: vi.fn(),
    onRenameCancel: vi.fn()
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FileGrid layout', () => {
  it('virtualizes responsive grid rows instead of mounting every file', async () => {
    const files = Array.from({ length: 12 }, (_, index) => ({
      ...imageFile,
      id: `image-${index}`,
      name: `photo-${index}.png`
    }))

    render(<FileGrid {...fileGridProps(files)} />)

    await waitFor(() => {
      expect(virtualizerMocks.useVirtualizer).toHaveBeenLastCalledWith(
        expect.objectContaining({ count: 6, overscan: 4 })
      )
    })
    const options = virtualizerMocks.useVirtualizer.mock.calls.at(-1)?.[0]
    expect(options?.getItemKey?.(0)).toBe('image-0')
    expect(screen.getByText('photo-0.png')).toBeInTheDocument()
    expect(screen.getByText('photo-1.png')).toBeInTheDocument()
    expect(screen.queryByText('photo-2.png')).not.toBeInTheDocument()
  })

  it('notifies the parent when responsive columns reduce the virtual content height', async () => {
    const files = Array.from({ length: 12 }, (_, index) => ({
      ...imageFile,
      id: `image-${index}`,
      name: `photo-${index}.png`
    }))
    const onLayoutChange = vi.fn()
    const props = { ...fileGridProps(files, 400), onLayoutChange }

    render(<FileGrid {...props} />)

    await waitFor(() => {
      expect(virtualizerMocks.useVirtualizer.mock.calls.some(([options]) => options.count === 12)).toBe(true)
      expect(virtualizerMocks.useVirtualizer).toHaveBeenLastCalledWith(expect.objectContaining({ count: 6 }))
      expect(onLayoutChange.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })
})

describe('FileGrid image preview', () => {
  const imageWithPreview: FileItem = { ...imageFile, previewUrl: 'safe-file:///tmp/photo.png' }

  it('renders the thumbnail and opens the file on a single click', () => {
    const props = fileGridProps([imageWithPreview])
    render(<FileGrid {...props} />)

    const thumbnail = screen.getByAltText('photo.png')
    expect(thumbnail).toHaveAttribute('src', 'safe-file:///tmp/photo.png')

    fireEvent.click(thumbnail)
    expect(props.onOpen).toHaveBeenCalledWith(imageWithPreview)
  })

  it('does not open a missing image on click', () => {
    const props = fileGridProps([{ ...imageFile, isMissing: true }])
    render(<FileGrid {...props} />)

    fireEvent.click(screen.getByText('photo.png'))
    expect(props.onOpen).not.toHaveBeenCalled()
  })

  it('exposes distinct source paths for same-name files', () => {
    const first: FileItem = {
      ...imageFile,
      id: 'file-migrated-a',
      name: 'migrated-image.png',
      sourcePath: '/Users/a/Pictures/migrated-image.png'
    }
    const second: FileItem = {
      ...first,
      id: 'file-migrated-b',
      sourcePath: '/Users/b/Downloads/migrated-image.png'
    }
    render(<FileGrid {...fileGridProps([first, second])} />)

    const names = screen.getAllByText('migrated-image.png')
    expect(names).toHaveLength(2)
    expect(names[0]).toHaveAttribute('title', '/Users/a/Pictures/migrated-image.png')
    expect(names[1]).toHaveAttribute('title', '/Users/b/Downloads/migrated-image.png')
  })
})
