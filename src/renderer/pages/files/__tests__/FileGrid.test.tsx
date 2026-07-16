// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FileContextMenuActions } from '../FileContextMenu'
import type { FileItem } from '../fileDisplay'
import { FileGrid } from '../FileGrid'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

// An image file without a preview URL renders the decorative placeholder
// gradient (no ImagePreviewTrigger), which is the surface under test here.
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

function fileGridProps(files: FileItem[]): ComponentProps<typeof FileGrid> {
  return {
    files,
    selectedIds: new Set(),
    onSelect: vi.fn(),
    onOpen: vi.fn(),
    onDelete: vi.fn(),
    isTrash: false,
    menuActions,
    renamingId: null,
    onRenameConfirm: vi.fn(),
    onRenameCancel: vi.fn()
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FileGrid placeholder gradients', () => {
  it('paints image placeholders with design-token gradients and no raw hex', () => {
    const { container } = render(<FileGrid {...fileGridProps([imageFile])} />)

    const gradientTarget = container.querySelector<HTMLElement>('[style*="background-image"]')

    expect(gradientTarget).not.toBeNull()
    const backgroundImage = gradientTarget?.style.backgroundImage ?? ''
    expect(backgroundImage).toContain('var(--color-')
    expect(backgroundImage).not.toMatch(/#[0-9a-fA-F]{3,6}/)
  })

  it('assigns a stable gradient per file name', () => {
    const first = render(<FileGrid {...fileGridProps([imageFile])} />)
    const firstGradient =
      first.container.querySelector<HTMLElement>('[style*="background-image"]')?.style.backgroundImage
    cleanup()

    const second = render(<FileGrid {...fileGridProps([imageFile])} />)
    const secondGradient =
      second.container.querySelector<HTMLElement>('[style*="background-image"]')?.style.backgroundImage

    expect(firstGradient).toBeTruthy()
    expect(secondGradient).toBe(firstGradient)
  })
})
