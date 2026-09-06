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

it('keeps a persisted out-of-range value inside the real controls aria range', () => {
  render(
    <PaintingFieldRenderer
      item={{
        type: 'slider',
        key: 'guidanceScale',
        title: 'paintings.guidance_scale',
        min: 0,
        max: 20,
        step: 0.1,
        initialValue: 4.5
      }}
      painting={{ guidanceScale: 99 }}
      onChange={vi.fn()}
    />
  )

  expect(screen.getByRole('slider', { name: 'paintings.guidance_scale' })).toHaveAttribute('aria-valuenow', '20')
  expect(screen.getByRole('spinbutton', { name: 'paintings.guidance_scale' })).toHaveAttribute('aria-valuenow', '20')
})
