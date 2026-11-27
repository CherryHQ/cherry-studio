import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

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
  it('requests deletion of the selected painting', async () => {
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
  })
})
