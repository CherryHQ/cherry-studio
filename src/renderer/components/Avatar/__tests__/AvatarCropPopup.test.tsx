import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PopupHost } from '@renderer/components/PopupHost'
import i18n from '@renderer/i18n/resolver'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'

import { AvatarCropPopup } from '../AvatarCropPopup'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

const file = new File(['image'], 'avatar.png', { type: 'image/png' })
// jsdom has no layout or decoder: give the crop box a size and the image its pixel dimensions.
const BOX = 288
let natural = { width: 3, height: 2 }

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
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockImplementation(() => natural.width)
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockImplementation(() => natural.height)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, BOX, BOX))
})

afterEach(() => {
  act(() => {
    for (const entry of [...popupService.getSnapshot()]) popupService.settle(entry.instanceId, undefined)
  })
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const image = () => document.querySelector('img') as HTMLImageElement

async function showCrop(shape: 'square' | 'round' = 'square', size = { width: 3, height: 2 }) {
  natural = size
  render(<PopupHost />)
  let result!: Promise<unknown>
  act(() => {
    result = AvatarCropPopup.show({ file, shape })
  })
  await screen.findByRole('dialog', { name: 'Crop avatar' })
  return { result }
}

describe('AvatarCropPopup', () => {
  // Catches the library rounding the 3×2 centered square's x from 0.5 to 1, shifting the crop.
  it('returns the untouched centered square of a tiny odd-sized image', async () => {
    const { result } = await showCrop()
    fireEvent.load(image())

    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await expect(result).resolves.toEqual({
      x: expect.closeTo(0.5),
      y: expect.closeTo(0),
      width: expect.closeTo(2),
      height: expect.closeTo(2)
    })
  })

  // Catches the library rounding a 1×1 image's quarter-pixel square at 4× zoom to width 0.
  it('keeps a non-empty source square for a 1×1 image at maximum zoom', async () => {
    const { result } = await showCrop('square', { width: 1, height: 1 })
    fireEvent.load(image())
    const user = userEvent.setup()

    screen.getByRole('slider', { name: 'Zoom' }).focus()
    await user.keyboard('{End}')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await expect(result).resolves.toEqual({
      x: expect.closeTo(0.375),
      y: expect.closeTo(0.375),
      width: expect.closeTo(0.25),
      height: expect.closeTo(0.25)
    })
  })

  // Catches a corrupt image leaving a blank dialog with Confirm disabled and no error shown.
  it('reports an image that cannot be decoded and returns nothing to save', async () => {
    const { result } = await showCrop()

    fireEvent.error(image())

    await expect(result).resolves.toBeNull()
    expect(toast.error).toHaveBeenCalledWith('Failed to process the image, please try again')
  })

  it('frames the user avatar in a circle', async () => {
    await showCrop('round')
    fireEvent.load(image())
    expect(document.querySelector('.reactEasyCrop_CropAreaRound')).toBeInTheDocument()
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

    expect(image().style.transform).toContain('scale(4)')
  })
})
