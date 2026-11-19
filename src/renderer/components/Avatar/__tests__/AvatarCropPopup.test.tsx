import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PopupHost } from '@renderer/components/PopupHost'
import i18n from '@renderer/i18n/resolver'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'

import { AvatarCropPopup } from '../AvatarCropPopup'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

const FRAMED = { x: 30, y: 12, width: 96, height: 96 }

// jsdom cannot load images, so the cropper reports a framed area as soon as it mounts.
vi.mock('react-easy-crop', () => ({
  default: function Cropper({
    zoom,
    cropShape,
    onCropComplete
  }: {
    zoom: number
    cropShape: string
    onCropComplete: (area: unknown, pixels: typeof FRAMED) => void
  }) {
    useEffect(() => onCropComplete({}, FRAMED), [onCropComplete])
    return <div data-testid="cropper" data-zoom={zoom} data-shape={cropShape} />
  }
}))

const file = new File(['image'], 'avatar.png', { type: 'image/png' })

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:avatar', revokeObjectURL: vi.fn() }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

afterEach(() => {
  act(() => {
    for (const entry of [...popupService.getSnapshot()]) popupService.settle(entry.instanceId, undefined)
  })
  cleanup()
  vi.unstubAllGlobals()
})

async function showCrop(shape: 'square' | 'round' = 'square') {
  render(<PopupHost />)
  let result!: Promise<unknown>
  act(() => {
    result = AvatarCropPopup.show({ file, shape })
  })
  await screen.findByRole('dialog', { name: 'Crop avatar' })
  return { result }
}

describe('AvatarCropPopup', () => {
  it('returns the framed area when confirmed', async () => {
    const { result } = await showCrop()

    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await expect(result).resolves.toEqual(FRAMED)
  })

  it('frames the user avatar in a circle', async () => {
    await showCrop('round')
    expect(screen.getByTestId('cropper')).toHaveAttribute('data-shape', 'round')
  })

  it.each([
    [
      'Cancel',
      (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Cancel' }))
    ],
    ['Escape', (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')]
  ])('returns nothing to save after %s', async (_, dismiss) => {
    const { result } = await showCrop()

    await dismiss(userEvent.setup())

    await expect(result).resolves.toBeNull()
    await act(() => new Promise((resolve) => setTimeout(resolve, POPUP_EXIT_MS)))
  })

  it('zooms from the keyboard through the labelled slider', async () => {
    await showCrop()
    const user = userEvent.setup()

    screen.getByRole('slider', { name: 'Zoom' }).focus()
    await user.keyboard('{End}')

    expect(screen.getByTestId('cropper')).toHaveAttribute('data-zoom', '4')
  })
})
