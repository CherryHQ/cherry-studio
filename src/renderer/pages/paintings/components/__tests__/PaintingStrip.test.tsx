import { render, screen } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import type { FileMetadata } from '@renderer/types/file'

import type { PaintingData } from '../../model/types/paintingData'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    size,
    type = 'button',
    variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode; size?: string; variant?: string }) => {
    void size
    void variant
    return (
      <button type={type} {...props}>
        {children}
      </button>
    )
  },
  ConfirmDialog: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => children
}))

vi.unmock('@data/hooks/useCache')

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
  beforeEach(() => {
    cacheService.set(`painting.generation.${painting.id}`, null)
    cacheService.set('painting.generation.painting-2', null)
  })

  it('shows the project preview when the original version has no output', () => {
    const { container } = render(
      <PaintingStrip
        items={[{ ...painting, previewFile: { id: 'later', path: '/tmp/later.png', ext: 'png' } as FileMetadata }]}
        hasMore={false}
        loadMore={vi.fn()}
        onDeletePainting={vi.fn()}
        onSelectPainting={vi.fn()}
        onAddPainting={vi.fn()}
      />
    )
    expect(container.querySelector('img')).toHaveAttribute('src', expect.stringContaining('later.png'))
  })

  it('keeps both running tasks busy even when neither is selected', () => {
    const state = { status: 'running' as const, taskId: null, error: null, progress: 0 }
    cacheService.set(`painting.generation.${painting.id}`, state)
    cacheService.set('painting.generation.painting-2', state)
    render(
      <PaintingStrip
        items={[painting, { ...painting, id: 'painting-2' }, { ...painting, id: 'idle' }]}
        hasMore={false}
        loadMore={vi.fn()}
        onDeletePainting={vi.fn()}
        onSelectPainting={vi.fn()}
        onAddPainting={vi.fn()}
      />
    )

    const tasks = screen.getAllByRole('button', { name: /paintings\.button\.select\.image/ })
    expect(tasks[0]).toHaveAttribute('aria-busy', 'true')
    expect(tasks[1]).toHaveAttribute('aria-busy', 'true')
    expect(tasks[2]).toHaveAttribute('aria-busy', 'false')
  })
})
