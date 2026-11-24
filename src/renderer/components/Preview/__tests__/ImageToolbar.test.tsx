import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ImageToolbar from '../ImageToolbar'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../ImageToolButton', () => ({
  default: ({ tooltip, onClick }: { tooltip: string; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {tooltip}
    </button>
  )
}))

describe('ImageToolbar', () => {
  const pan = vi.fn()
  const zoom = vi.fn()
  const openDialog = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps the directional controls to pan offsets', async () => {
    const user = userEvent.setup()
    render(<ImageToolbar pan={pan} zoom={zoom} dialog={openDialog} />)

    expect(screen.getByRole('toolbar', { name: 'preview.label' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'preview.pan_up' }))
    await user.click(screen.getByRole('button', { name: 'preview.pan_down' }))
    await user.click(screen.getByRole('button', { name: 'preview.pan_left' }))
    await user.click(screen.getByRole('button', { name: 'preview.pan_right' }))

    expect(pan.mock.calls[0][0]).toBe(0)
    expect(pan.mock.calls[0][1]).toBeLessThan(0)
    expect(pan.mock.calls[1][0]).toBe(0)
    expect(pan.mock.calls[1][1]).toBeGreaterThan(0)
    expect(pan.mock.calls[2][0]).toBeLessThan(0)
    expect(pan.mock.calls[2][1]).toBe(0)
    expect(pan.mock.calls[3][0]).toBeGreaterThan(0)
    expect(pan.mock.calls[3][1]).toBe(0)
  })

  it('maps zoom and reset controls to their image actions', async () => {
    const user = userEvent.setup()
    render(<ImageToolbar pan={pan} zoom={zoom} dialog={openDialog} />)

    await user.click(screen.getByRole('button', { name: 'preview.zoom_in' }))
    await user.click(screen.getByRole('button', { name: 'preview.zoom_out' }))
    await user.click(screen.getByRole('button', { name: 'preview.reset' }))

    expect(zoom.mock.calls[0][0]).toBeGreaterThan(0)
    expect(zoom.mock.calls[1][0]).toBeLessThan(0)
    expect(pan).toHaveBeenCalledWith(0, 0, true)
    expect(zoom).toHaveBeenNthCalledWith(3, 1, true)
  })

  it('opens the full-size preview from the dialog control', async () => {
    const user = userEvent.setup()
    render(<ImageToolbar pan={pan} zoom={zoom} dialog={openDialog} />)

    await user.click(screen.getByRole('button', { name: 'preview.dialog' }))

    expect(openDialog).toHaveBeenCalledOnce()
  })

  it('hides pan/zoom controls but keeps the dialog control when pan/zoom is disabled', async () => {
    const user = userEvent.setup()
    render(<ImageToolbar pan={pan} zoom={zoom} dialog={openDialog} enablePanZoom={false} />)

    expect(screen.queryByRole('button', { name: 'preview.pan_up' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'preview.zoom_in' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'preview.reset' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'preview.dialog' }))

    expect(openDialog).toHaveBeenCalledOnce()
    expect(pan).not.toHaveBeenCalled()
    expect(zoom).not.toHaveBeenCalled()
  })
})
