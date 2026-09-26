import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'
import { createFileEntryHandle, createFilePathHandle } from '@shared/utils/file'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request }
}))

vi.mock('../ImageBlock', () => ({
  default: ({ images }: { images: string[] }) => <div data-testid="image-block" data-images={JSON.stringify(images)} />
}))

import MessageImageBlock from '../MessageImageBlock'

const images = () => JSON.parse(screen.getByTestId('image-block').getAttribute('data-images') ?? '[]') as string[]

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
