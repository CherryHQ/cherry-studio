vi.unmock('@cherrystudio/ui')
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { IpcError } from '@shared/ipc/errors/IpcError'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import HeifFilePreview from '../HeifFilePreview'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: mocks }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const props = {
  filePath: AbsoluteFilePathSchema.parse('/tmp/photo.heic'),
  fileName: 'photo.heic',
  metadata: { size: 674, modifiedAt: 1 },
  refreshKey: 0
}
const png = { content: new Uint8Array([137, 80, 78, 71]) }

beforeEach(() => {
  mocks.request.mockReset().mockResolvedValue(png)
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:png') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})
afterEach(() => vi.restoreAllMocks())

it('renders a PNG rendition and releases only its own URL when closed', async () => {
  const { unmount } = render(<HeifFilePreview {...props} />)
  expect(screen.queryByRole('img')).toBeNull()
  const image = await screen.findByAltText('photo.heic')
  expect(image).toHaveAttribute('src', 'blob:png')
  expect(mocks.request).toHaveBeenCalledWith('file.get_heif_rendition', {
    source: { kind: 'path', path: '/tmp/photo.heic' }
  })
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:png')
})

it('contains decoder failures with actionable HEIF copy and never renders raw bytes', async () => {
  mocks.request.mockRejectedValueOnce(new IpcError('FILE_HEIF_UNAVAILABLE'))
  render(<HeifFilePreview {...props} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('error.heif_detail_unavailable')
  expect(screen.queryByRole('img')).toBeNull()
})

it('discards a conversion completed after the preview closed', async () => {
  let complete!: (value: typeof png) => void
  mocks.request.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve
    })
  )
  const { unmount } = render(<HeifFilePreview {...props} />)
  unmount()
  await act(async () => complete(png))
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})

it('releases the previous rendition on refresh and ignores its obsolete completion', async () => {
  let complete!: (value: typeof png) => void
  mocks.request.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve
    })
  )
  const { rerender } = render(<HeifFilePreview {...props} />)
  rerender(<HeifFilePreview {...props} refreshKey={1} />)
  await screen.findByAltText('photo.heic')
  await act(async () => complete(png))
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1))
})
