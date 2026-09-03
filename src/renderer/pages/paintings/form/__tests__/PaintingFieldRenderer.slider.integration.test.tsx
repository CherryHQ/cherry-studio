import type * as CherryStudioUI from '@cherrystudio/ui'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'

import { PaintingFieldRenderer } from '../PaintingFieldRenderer'

vi.mock('@cherrystudio/ui', async () => vi.importActual<typeof CherryStudioUI>('@cherrystudio/ui'))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

it('moves a step-declared range through the real Slider keyboard contract', async () => {
  const user = userEvent.setup()

  function ControlledRange() {
    const [numImages, setNumImages] = useState(1)
    return (
      <PaintingFieldRenderer
        item={{
          type: 'slider',
          key: 'numImages',
          title: 'paintings.num_images',
          min: 1,
          max: 4,
          step: 1,
          initialValue: 1
        }}
        painting={{ numImages }}
        onChange={(updates) => setNumImages(updates.numImages as number)}
      />
    )
  }

  render(<ControlledRange />)

  const slider = screen.getByRole('slider', { name: 'paintings.num_images' })
  await user.tab()
  expect(slider).toHaveFocus()
  await user.keyboard('{ArrowRight}')

  expect(slider).toHaveAttribute('aria-valuenow', '2')
  expect(screen.getByRole('spinbutton', { name: 'paintings.num_images' })).toHaveDisplayValue('2')
})
