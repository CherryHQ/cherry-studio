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

it('keeps the slider synchronized when the numeric companion steps with arrow keys', async () => {
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

  const input = screen.getByRole('spinbutton', { name: 'paintings.num_images' })
  await user.click(input)
  await user.keyboard('{ArrowUp}')

  expect(input).toHaveDisplayValue('2')
  expect(screen.getByRole('slider', { name: 'paintings.num_images' })).toHaveAttribute('aria-valuenow', '2')
})

it.each([
  ['99', '{ArrowUp}', '4'],
  ['0', '{ArrowDown}', '1']
])('does not commit a boundary when %s remains out of range after %s', async (draft, key, settled) => {
  const user = userEvent.setup()

  function ControlledRange() {
    const [numImages, setNumImages] = useState(2)
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

  const input = screen.getByRole('spinbutton', { name: 'paintings.num_images' })
  const slider = screen.getByRole('slider', { name: 'paintings.num_images' })
  await user.clear(input)
  await user.type(input, draft)
  await user.keyboard(key)

  expect(input).toHaveDisplayValue(draft)
  expect(slider).toHaveAttribute('aria-valuenow', '2')

  await user.tab()
  expect(input).toHaveDisplayValue(settled)
  expect(slider).toHaveAttribute('aria-valuenow', settled)
})

it('discards a focused draft when a same-key model changes the range constraints', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const { rerender } = render(
    <PaintingFieldRenderer
      item={{ type: 'slider', key: 'strength', min: 0, max: 20, step: 0.1, initialValue: 4.5 }}
      painting={{ strength: 4.5 }}
      onChange={onChange}
    />
  )

  const input = screen.getByRole('spinbutton', { name: 'strength' })
  await user.clear(input)
  await user.type(input, '12')

  rerender(
    <PaintingFieldRenderer
      item={{ type: 'slider', key: 'strength', min: 0, max: 10, step: 1, initialValue: 7 }}
      painting={{ strength: 7 }}
      onChange={onChange}
    />
  )

  expect(input).toHaveDisplayValue('7')
})

it('does not expose a transient out-of-range draft as the current aria value', async () => {
  const user = userEvent.setup()
  render(
    <PaintingFieldRenderer
      item={{ type: 'slider', key: 'strength', min: 0, max: 20, step: 0.1, initialValue: 4.5 }}
      painting={{ strength: 4.5 }}
      onChange={vi.fn()}
    />
  )

  const input = screen.getByRole('spinbutton', { name: 'strength' })
  await user.clear(input)
  await user.type(input, '99')

  expect(input).toHaveDisplayValue('99')
  expect(input).not.toHaveAttribute('aria-valuenow')
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
