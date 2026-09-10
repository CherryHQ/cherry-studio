// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { AbsoluteFilePath } from '@shared/types/file'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentType, HTMLAttributes } from 'react'
import { describe, expect, it, vi } from 'vitest'

import VideoFilePreview from '../VideoFilePreview'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn() }) }
}))

vi.mock('@cherrystudio/ui', () => ({
  EmptyState: ({ title, description }: { icon?: ComponentType; title: string; description?: string }) => (
    <div>
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
  Scrollbar: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const filePath = '/tmp/video-preview.mp4' as AbsoluteFilePath
const metadata = { size: 1024 }

describe('VideoFilePreview', () => {
  it('uses the native media controls and clears loading when metadata arrives', () => {
    render(<VideoFilePreview filePath={filePath} fileName="video-preview.mp4" refreshKey={0} metadata={metadata} />)

    const video = screen.getByLabelText('video-preview.mp4')
    expect(video).toHaveAttribute('controls')
    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')

    fireEvent.loadedMetadata(video)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows the file-preview error state when the browser rejects the media', () => {
    render(<VideoFilePreview filePath={filePath} fileName="video-preview.mp4" refreshKey={0} metadata={metadata} />)

    fireEvent.error(screen.getByLabelText('video-preview.mp4'))

    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.video.load_error.title')
  })

  it('returns to loading when refresh remounts the media element', () => {
    const { rerender } = render(
      <VideoFilePreview filePath={filePath} fileName="video-preview.mp4" refreshKey={0} metadata={metadata} />
    )
    fireEvent.loadedMetadata(screen.getByLabelText('video-preview.mp4'))

    rerender(<VideoFilePreview filePath={filePath} fileName="video-preview.mp4" refreshKey={1} metadata={metadata} />)

    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')
  })
})
