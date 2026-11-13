// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Slider } from '../slider'

function Controlled({ snapOnRelease = true }: { snapOnRelease?: boolean }) {
  const [value, setValue] = useState([0])
  return (
    <>
      <Slider
        aria-label="Effort track"
        getThumbAriaLabel={() => 'Effort'}
        min={0}
        max={5}
        value={value}
        snapOnRelease={snapOnRelease}
        onValueChange={setValue}
      />
      <output aria-label="Selected effort">{value[0]}</output>
    </>
  )
}

beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 500,
    bottom: 20,
    width: 500,
    height: 20,
    toJSON: () => ({})
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
  HTMLElement.prototype.hasPointerCapture = () => true
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Slider release snapping', () => {
  it('tracks fractional pointer positions without sending fractional selections, then settles on release', () => {
    render(<Controlled />)
    const thumb = screen.getByRole('slider', { name: 'Effort' })
    fireEvent.pointerDown(thumb, { button: 0, clientX: 0 })
    fireEvent.pointerMove(thumb, { clientX: 235 })
    expect(thumb).toHaveAttribute('aria-valuenow', '2.35')
    expect(screen.getByLabelText('Selected effort')).toHaveTextContent('2')
    fireEvent.pointerUp(thumb, { clientX: 235 })
    fireEvent.lostPointerCapture(thumb)
    expect(thumb).toHaveAttribute('aria-valuenow', '2')
  })

  it('settles after cancellation and still allows full-step keyboard changes', async () => {
    const user = userEvent.setup()
    render(<Controlled />)
    const thumb = screen.getByRole('slider', { name: 'Effort' })
    fireEvent.pointerDown(thumb, { button: 0 })
    fireEvent.pointerMove(thumb, { clientX: 270 })
    fireEvent.pointerCancel(thumb)
    expect(thumb).toHaveAttribute('aria-valuenow', '3')
    thumb.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByLabelText('Selected effort')).toHaveTextContent('4')
    await user.keyboard('{End}')
    expect(screen.getByLabelText('Selected effort')).toHaveTextContent('5')
  })

  it('keeps immediate step snapping when the option is disabled', () => {
    render(<Controlled snapOnRelease={false} />)
    const thumb = screen.getByRole('slider', { name: 'Effort' })
    fireEvent.pointerDown(thumb, { button: 0 })
    fireEvent.pointerMove(thumb, { clientX: 235 })
    expect(thumb).toHaveAttribute('aria-valuenow', '2')
    expect(screen.getByLabelText('Selected effort')).toHaveTextContent('2')
  })
})
