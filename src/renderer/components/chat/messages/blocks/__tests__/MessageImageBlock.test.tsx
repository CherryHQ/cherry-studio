import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'
import { createFileEntryHandle, createFilePathHandle } from '@shared/utils/file'

import type { ImageBlockItem } from '../ImageBlock'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request }
}))

vi.mock('../ImageBlock', () => ({
  default: ({ images }: { images: ImageBlockItem[] }) => (
    <div data-testid="image-block" data-images={JSON.stringify(images)} />
  )
}))

import MessageImageBlock from '../MessageImageBlock'

const gallery = () =>
  JSON.parse(screen.getByTestId('image-block').getAttribute('data-images') ?? '[]') as ImageBlockItem[]
const images = () => gallery().map((item) => (typeof item === 'string' ? item : item.src))

describe('MessageImageBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a managed image from its current location once resolved, showing the stored url meanwhile', async () => {
    const managed = { handle: createFileEntryHandle('entry-1'), url: 'file:///old/machine/Files/entry-1.png' }
    const remote = { url: 'https://img.test/a.png' }
    const local = { handle: createFilePathHandle('/tmp/local.png' as AbsoluteFilePath), url: 'file:///tmp/local.png' }
    mocks.request.mockResolvedValue({ 'entry-1': '/Users/me/Data/Files/entry-1.png' })

    render(<MessageImageBlock sources={[managed, remote, local]} />)

    expect(images()).toEqual([managed.url, remote.url, local.url])
    await waitFor(() => expect(images()).toEqual(['file:///Users/me/Data/Files/entry-1.png', remote.url, local.url]))
    expect(mocks.request).toHaveBeenCalledWith('file.batch_get_physical_paths', { ids: ['entry-1'] })
  })

  it('keeps the stored url when the entry no longer exists and skips the lookup without managed images', async () => {
    mocks.request.mockResolvedValue({ gone: null })
    const { unmount } = render(
      <MessageImageBlock sources={[{ handle: createFileEntryHandle('gone'), url: 'file:///tmp/gone.png' }]} />
    )
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1))
    expect(images()).toEqual(['file:///tmp/gone.png'])
    unmount()

    render(<MessageImageBlock sources={[{ url: 'data:image/png;base64,AAAA' }]} />)
    expect(images()).toEqual(['data:image/png;base64,AAAA'])
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })
})

it('preserves the PNG source identity when an earlier HEIF rendition joins the gallery', async () => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:message-png') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  let resolveRendition!: (result: { content: Uint8Array }) => void
  mocks.request.mockReturnValue(
    new Promise((resolve) => {
      resolveRendition = resolve
    })
  )
  render(
    <MessageImageBlock
      sources={[
        { url: 'file:///tmp/photo.heic', mediaType: 'image/heic' },
        { url: 'file:///tmp/ordinary.png', mediaType: 'image/png' }
      ]}
    />
  )

  const png = { id: 'message-image-1', src: 'file:///tmp/ordinary.png' }
  expect(gallery()).toEqual([png])
  expect(screen.getByRole('status')).toBeInTheDocument()

  await act(async () => resolveRendition({ content: new Uint8Array([137, 80, 78, 71]) }))

  expect(gallery()).toEqual([{ id: 'message-image-0', src: 'blob:message-png' }, png])
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('keeps raw HEIF out of thumbnails and lightbox inputs while preserving ordinary images', async () => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:message-png') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  mocks.request.mockResolvedValue({ content: new Uint8Array([137, 80, 78, 71]) })
  const { unmount } = render(
    <MessageImageBlock
      sources={[
        { url: 'file:///tmp/photo', mediaType: 'image/heic', filename: 'photo.heic' },
        { url: 'file:///tmp/ordinary.png', mediaType: 'image/png' }
      ]}
    />
  )
  expect(images()).toEqual(['file:///tmp/ordinary.png'])
  await waitFor(() => expect(images()).toEqual(['blob:message-png', 'file:///tmp/ordinary.png']))
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:message-png')
})

it('keeps the HEIF rendition in ImageBlock when attachment sources rerender with equal values', async () => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:message-png') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  mocks.request.mockResolvedValue({ content: new Uint8Array([137, 80, 78, 71]) })
  const { rerender } = render(
    <MessageImageBlock sources={[{ url: 'file:///tmp/photo.heic', mediaType: 'image/heic', filename: 'photo.heic' }]} />
  )
  await waitFor(() => expect(images()).toEqual(['blob:message-png']))

  rerender(
    <MessageImageBlock sources={[{ url: 'file:///tmp/photo.heic', mediaType: 'image/heic', filename: 'photo.heic' }]} />
  )

  expect(images()).toEqual(['blob:message-png'])
  expect(mocks.request).toHaveBeenCalledExactlyOnceWith('file.get_heif_rendition', {
    source: { kind: 'path', path: '/tmp/photo.heic' }
  })
  expect(URL.revokeObjectURL).not.toHaveBeenCalled()
})
