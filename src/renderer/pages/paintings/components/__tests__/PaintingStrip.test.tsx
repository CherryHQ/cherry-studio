import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { loggerService } from '@logger'
import type { FileMetadata } from '@renderer/types/file'

import type { PaintingData } from '../../model/types/paintingData'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('../PaintingSkeletonSurface', () => ({
  default: () => <div data-testid="painting-skeleton-surface" />
}))

const { default: PaintingStrip } = await import('../PaintingStrip')

const painting: PaintingData = {
  id: 'painting-1',
  providerId: 'openai',
  mode: 'generate',
  model: 'gpt-image-1',
  prompt: '',
  files: []
}

describe('PaintingStrip', () => {
  it('renders SVG bytes as a non-draggable blob image instead of the guarded directory URL', async () => {
    const bytes = new Uint8Array([60, 115, 118, 103, 62, 13, 10, 0, 255])
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:strip-svg')
    const revokeObjectURL = vi.fn()
    const browserUrl = URL
    vi.stubGlobal(
      'URL',
      class extends browserUrl {
        static createObjectURL = createObjectURL
        static revokeObjectURL = revokeObjectURL
      }
    )
    vi.mocked(window.api.ipcApi.request).mockResolvedValue({ ok: true, data: { content: bytes } })
    const file: FileMetadata = {
      id: 'svg-1',
      path: '/tmp/generated.svg',
      ext: 'SVG',
      name: 'generated.svg',
      origin_name: 'generated.svg',
      size: bytes.length,
      type: 'image',
      created_at: '2026-01-01',
      count: 1
    }
    const { unmount } = render(
      <PaintingStrip
        items={[{ ...painting, files: [file] }]}
        hasMore={false}
        loadMore={vi.fn()}
        onDeletePainting={vi.fn()}
        onSelectPainting={vi.fn()}
        onAddPainting={vi.fn()}
      />
    )
    try {
      await waitFor(() => expect(document.querySelector('img')).toHaveAttribute('src', 'blob:strip-svg'))
      expect(document.querySelector('img')).toHaveAttribute('draggable', 'false')
      const blob = createObjectURL.mock.calls[0][0]
      expect(blob.type).toBe('image/svg+xml')
      const stored = await new Promise<ArrayBuffer>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.readAsArrayBuffer(blob)
      })
      expect(new Uint8Array(stored)).toEqual(bytes)
      unmount()
      expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:strip-svg')
    } finally {
      unmount()
      vi.stubGlobal('URL', browserUrl)
    }
  })

  it.each([false, true])('uses the neutral placeholder after an SVG read fails (generating: %s)', async (running) => {
    const warn = vi.spyOn(loggerService, 'warn').mockImplementation(() => {})
    vi.mocked(window.api.ipcApi.request).mockRejectedValue(new Error('entry missing'))
    render(
      <PaintingStrip
        runningPaintingId={running ? painting.id : undefined}
        items={[
          {
            ...painting,
            files: [
              {
                id: 'missing',
                path: '/tmp/missing.svg',
                ext: 'svg',
                name: 'missing.svg',
                origin_name: 'missing.svg',
                size: 1,
                type: 'image',
                created_at: '2026-01-01',
                count: 1
              }
            ]
          }
        ]}
        hasMore={false}
        loadMore={vi.fn()}
        onDeletePainting={vi.fn()}
        onSelectPainting={vi.fn()}
        onAddPainting={vi.fn()}
      />
    )
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1))
    expect(document.querySelector('img')).toBeNull()
    expect(screen.queryByTestId('painting-skeleton-surface')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'paintings.button.select.image' })).toBeInTheDocument()
    warn.mockRestore()
  })

  it('uses the skeleton surface for a running painting without a preview yet', () => {
    render(
      <PaintingStrip
        runningPaintingId={painting.id}
        items={[painting]}
        hasMore={false}
        loadMore={vi.fn()}
        onDeletePainting={vi.fn()}
        onSelectPainting={vi.fn()}
        onAddPainting={vi.fn()}
      />
    )

    expect(screen.getByTestId('painting-skeleton-surface')).toBeInTheDocument()
  })

  it('moves a painting to the Recycle Bin without opening a confirmation', async () => {
    const user = userEvent.setup()
    const onDeletePainting = vi.fn().mockResolvedValue(undefined)

    render(
      <PaintingStrip
        items={[painting]}
        hasMore={false}
        loadMore={vi.fn()}
        onDeletePainting={onDeletePainting}
        onSelectPainting={vi.fn()}
        onAddPainting={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'paintings.button.delete.image.label' }))
    expect(onDeletePainting).toHaveBeenCalledWith(painting)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
