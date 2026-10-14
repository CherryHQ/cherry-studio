import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createFileEntryHandle } from '@shared/utils/file'

const mocks = vi.hoisted(() => ({
  warn: vi.fn(),
  request: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({ debug: vi.fn(), warn: mocks.warn })
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('react-player', () => ({
  default: ({ src, controls }: { src: string; controls: boolean }) => (
    <video data-testid="video-player" data-src={src} controls={controls} />
  )
}))

const { default: MessageVideo } = await import('../MessageVideo')

describe('MessageVideo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['https://cdn.example.com/result.mp4', 'http://cdn.example.com/result.webm'])(
    'renders the remote video URL %s with playback controls',
    (url) => {
      render(<MessageVideo url={url} />)

      expect(screen.getByTestId('video-player')).toHaveAttribute('data-src', url)
      expect(screen.getByTestId('video-player')).toHaveAttribute('controls')
      expect(mocks.warn).not.toHaveBeenCalled()
    }
  )

  it('keeps local video playback ahead of a remote fallback URL', () => {
    render(<MessageVideo filePath="/tmp/result.mp4" url="https://cdn.example.com/fallback.mp4" />)

    expect(screen.getByTestId('video-player')).toHaveAttribute('data-src', 'file:///tmp/result.mp4')
  })

  it('plays a generated attachment from its current managed location after data migration', async () => {
    mocks.request.mockResolvedValue({ 'video-entry': 'C:/Moved Files/video #1.mp4' })
    render(<MessageVideo handle={createFileEntryHandle('video-entry')} url="file:///old/video.mp4" />)

    await waitFor(() =>
      expect(screen.getByTestId('video-player')).toHaveAttribute(
        'data-src',
        'file:///C:/Moved%20Files/video%20%231.mp4'
      )
    )
    expect(screen.getByTestId('video-player')).toHaveAttribute('controls')
  })

  it('preserves the stored local URL when the managed entry is unavailable', async () => {
    mocks.request.mockRejectedValue(new Error('Entry unavailable'))
    render(<MessageVideo handle={createFileEntryHandle('missing')} url="file:///C:/Files/video%20%231.mp4" />)

    await waitFor(() => expect(mocks.warn).toHaveBeenCalled())
    expect(screen.getByTestId('video-player')).toHaveAttribute('data-src', 'file:///C:/Files/video%20%231.mp4')
  })

  it('keeps unsupported URL schemes out of the player', () => {
    render(<MessageVideo url="ftp://example.com/result.mp4" />)

    expect(screen.queryByTestId('video-player')).not.toBeInTheDocument()
    expect(screen.getByText('message.video.error.unsupported_type')).toBeInTheDocument()
    expect(mocks.warn).toHaveBeenCalledOnce()
  })
})
