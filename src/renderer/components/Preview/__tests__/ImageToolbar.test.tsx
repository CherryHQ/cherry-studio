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

    expect(pan).toHaveBeenNthCalledWith(1, 0, -20)
    expect(pan).toHaveBeenNthCalledWith(2, 0, 20)
    expect(pan).toHaveBeenNthCalledWith(3, -20, 0)
    expect(pan).toHaveBeenNthCalledWith(4, 20, 0)
  })

  it('maps zoom and reset controls to their image actions', async () => {
    const user = userEvent.setup()
    render(<ImageToolbar pan={pan} zoom={zoom} dialog={openDialog} />)

    await user.click(screen.getByRole('button', { name: 'preview.zoom_in' }))
    await user.click(screen.getByRole('button', { name: 'preview.zoom_out' }))
    await user.click(screen.getByRole('button', { name: 'preview.reset' }))

    expect(zoom).toHaveBeenNthCalledWith(1, 0.1)
    expect(zoom).toHaveBeenNthCalledWith(2, -0.1)
    expect(pan).toHaveBeenCalledWith(0, 0, true)
    expect(zoom).toHaveBeenNthCalledWith(3, 1, true)
  })

  it('opens the full-size preview from the dialog control', async () => {
    const user = userEvent.setup()
    render(<ImageToolbar pan={pan} zoom={zoom} dialog={openDialog} />)

    await user.click(screen.getByRole('button', { name: 'preview.dialog' }))

    expect(openDialog).toHaveBeenCalledOnce()
  })
})
