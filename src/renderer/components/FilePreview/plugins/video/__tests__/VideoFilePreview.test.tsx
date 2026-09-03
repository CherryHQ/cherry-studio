import '@testing-library/jest-dom/vitest'

import type { AbsoluteFilePath } from '@shared/types/file'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentPropsWithoutRef, ComponentType, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import VideoFilePreview, { formatVideoTime } from '../VideoFilePreview'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: ComponentPropsWithoutRef<'button'> & { size?: string; variant?: string }) => {
    const buttonProps = { ...props }
    delete buttonProps.size
    delete buttonProps.variant

    return (
      <button type="button" {...buttonProps}>
        {children}
      </button>
    )
  },
  EmptyState: ({
    icon: Icon,
    title,
    description
  }: {
    icon?: ComponentType<{ size?: number }>
    title: string
    description?: string
  }) => (
    <div>
      {Icon ? <Icon /> : null}
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
  MenuItem: ({
    label,
    ...props
  }: ComponentPropsWithoutRef<'button'> & { active?: boolean; label: string; size?: string }) => {
    const buttonProps = { ...props }
    delete buttonProps.active
    delete buttonProps.size

    return (
      <button type="button" {...buttonProps}>
        {label}
      </button>
    )
  },
  MenuList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({
    children,
    portalContainer,
    ...props
  }: ComponentPropsWithoutRef<'div'> & {
    align?: string
    portalContainer?: HTMLElement | null
    side?: string
    sideOffset?: number
  }) => {
    const divProps = { ...props }
    delete divProps.align
    delete divProps.side
    delete divProps.sideOffset

    return (
      <div
        {...divProps}
        data-testid="video-popover-content"
        data-portal-container={portalContainer?.getAttribute('data-testid') ?? ''}>
        {children}
      </div>
    )
  },
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  Scrollbar: ({ children, ...props }: ComponentPropsWithoutRef<'div'>) => <div {...props}>{children}</div>,
  Slider: ({
    value,
    min,
    max,
    step,
    className,
    'aria-label': ariaLabel,
    onValueChange
  }: {
    value: number[]
    min: number
    max: number
    step: number
    className?: string
    'aria-label': string
    onValueChange?: (value: number[]) => void
  }) => (
    <input
      aria-label={ariaLabel}
      className={className}
      max={max}
      min={min}
      step={step}
      type="range"
      value={value[0]}
      onChange={(event) => onValueChange?.([Number(event.currentTarget.value)])}
    />
  ),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { speed?: string; volume?: number }) => options?.speed ?? options?.volume ?? key
  })
}))

const filePath = '/tmp/videos/demo clip.mp4' as AbsoluteFilePath

function renderPreview(
  overrides: Partial<{
    filePath: AbsoluteFilePath
    fileName: string
    refreshKey: number
  }> = {}
) {
  return render(
    <VideoFilePreview
      filePath={overrides.filePath ?? filePath}
      fileName={overrides.fileName ?? 'demo clip.mp4'}
      metadata={{ size: 42 }}
      refreshKey={overrides.refreshKey ?? 0}
    />
  )
}

describe('VideoFilePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a local video through a file URL without native controls', () => {
    renderPreview()

    const video = screen.getByLabelText('demo clip.mp4')
    expect(video.tagName).toBe('VIDEO')
    expect(video).not.toHaveAttribute('controls')
    expect(video).toHaveAttribute('disablePictureInPicture')
    expect(video).toHaveAttribute('disableRemotePlayback')
    expect(video).toHaveAttribute('preload', 'metadata')
    expect(video).toHaveAttribute('src', 'file:///tmp/videos/demo%20clip.mp4')
  })

  it('shows loading feedback until metadata loads, then shows custom controls', () => {
    renderPreview()

    const video = screen.getByLabelText('demo clip.mp4')
    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')

    Object.defineProperty(video, 'duration', { configurable: true, value: 125 })
    fireEvent.loadedMetadata(video)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'file_preview.video.play' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'file_preview.video.volume' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'file_preview.video.speed' })).toHaveTextContent('1x')
    expect(screen.getByRole('button', { name: 'file_preview.video.fullscreen' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'file_preview.video.seek' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'file_preview.video.volume' })).toBeInTheDocument()
    expect(screen.getByText('0:00 / 2:05')).toBeInTheDocument()
  })

  it('uses high-contrast custom controls over video content', () => {
    renderPreview()

    const video = screen.getByLabelText('demo clip.mp4')
    Object.defineProperty(video, 'duration', { configurable: true, value: 125 })
    fireEvent.loadedMetadata(video)

    expect(screen.getByRole('slider', { name: 'file_preview.video.seek' })).toHaveClass(
      '[&_[data-slot=slider-track]]:h-1.5',
      '[&_[data-slot=slider-track]]:bg-white/40',
      '[&_[data-slot=slider-thumb]]:size-4'
    )
    expect(screen.getByRole('button', { name: '1x' })).toHaveClass(
      'text-white',
      'hover:bg-white/15',
      'data-[active=true]:bg-white/20'
    )
  })

  it('plays and pauses through the custom playback button', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    renderPreview()

    const video = screen.getByLabelText('demo clip.mp4')
    Object.defineProperty(video, 'duration', { configurable: true, value: 10 })
    Object.defineProperty(video, 'paused', { configurable: true, value: true })
    fireEvent.loadedMetadata(video)

    fireEvent.click(screen.getByRole('button', { name: 'file_preview.video.play' }))
    expect(play).toHaveBeenCalledTimes(1)

    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    fireEvent.click(screen.getByRole('button', { name: 'file_preview.video.pause' }))
    expect(pause).toHaveBeenCalledTimes(1)
  })

  it('seeks and changes volume through custom controls', () => {
    renderPreview()

    const video = screen.getByLabelText('demo clip.mp4') as HTMLVideoElement
    Object.defineProperty(video, 'duration', { configurable: true, value: 120 })
    fireEvent.loadedMetadata(video)

    fireEvent.change(screen.getByRole('slider', { name: 'file_preview.video.seek' }), { target: { value: '42' } })
    expect(video.currentTime).toBe(42)

    fireEvent.change(screen.getByRole('slider', { name: 'file_preview.video.volume' }), { target: { value: '0.42' } })
    expect(video.volume).toBe(0.42)
    expect(video.muted).toBe(false)

    fireEvent.change(screen.getByRole('slider', { name: 'file_preview.video.volume' }), { target: { value: '0' } })
    expect(video.volume).toBe(0)
    expect(video.muted).toBe(true)
    expect(screen.getByRole('button', { name: 'file_preview.video.unmute' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('slider', { name: 'file_preview.video.volume' }), { target: { value: '0.2' } })
    expect(video.volume).toBe(0.2)
    expect(video.muted).toBe(false)
    expect(screen.getByRole('button', { name: 'file_preview.video.volume' })).toBeInTheDocument()
  })

  it('restores the last non-zero volume when unmuting', () => {
    renderPreview()

    const video = screen.getByLabelText('demo clip.mp4') as HTMLVideoElement
    fireEvent.loadedMetadata(video)

    fireEvent.change(screen.getByRole('slider', { name: 'file_preview.video.volume' }), { target: { value: '0.35' } })
    fireEvent.click(screen.getByRole('button', { name: 'file_preview.video.volume' }))

    expect(video.muted).toBe(false)
    expect(video.volume).toBe(0.35)

    fireEvent.click(screen.getByRole('button', { name: 'file_preview.video.mute' }))

    expect(video.muted).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'file_preview.video.unmute' }))

    expect(video.muted).toBe(false)
    expect(video.volume).toBe(0.35)
  })

  it('sets playback speed from the custom speed menu', () => {
    renderPreview()

    const video = screen.getByLabelText('demo clip.mp4') as HTMLVideoElement
    fireEvent.loadedMetadata(video)

    fireEvent.click(screen.getByRole('button', { name: '1.5x' }))

    expect(video.playbackRate).toBe(1.5)
    expect(screen.getByRole('button', { name: 'file_preview.video.speed' })).toHaveTextContent('1.5x')
  })

  it('keeps video popovers inside the fullscreen shell', () => {
    renderPreview()

    const video = screen.getByLabelText('demo clip.mp4') as HTMLVideoElement
    fireEvent.loadedMetadata(video)

    const shell = screen.getByTestId('video-preview-shell')
    for (const popover of screen.getAllByTestId('video-popover-content')) {
      expect(popover).toHaveAttribute('data-portal-container', shell.getAttribute('data-testid'))
    }
  })

  it('sets playback speed after the video shell enters fullscreen', () => {
    renderPreview()

    const video = screen.getByLabelText('demo clip.mp4') as HTMLVideoElement
    fireEvent.loadedMetadata(video)
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: screen.getByTestId('video-preview-shell')
    })
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'))
    })

    fireEvent.click(screen.getByRole('button', { name: '2x' }))

    expect(video.playbackRate).toBe(2)
    expect(screen.getByRole('button', { name: 'file_preview.video.speed' })).toHaveTextContent('2x')
  })

  it('enters and exits fullscreen from the custom fullscreen button', () => {
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined)
    })
    const requestFullscreen = vi.spyOn(HTMLElement.prototype, 'requestFullscreen').mockResolvedValue(undefined)
    const exitFullscreen = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
    renderPreview()

    const video = screen.getByLabelText('demo clip.mp4')
    fireEvent.loadedMetadata(video)

    fireEvent.click(screen.getByRole('button', { name: 'file_preview.video.fullscreen' }))
    expect(requestFullscreen).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: video.parentElement
    })
    fireEvent.click(screen.getByRole('button', { name: 'file_preview.video.fullscreen' }))
    expect(exitFullscreen).toHaveBeenCalledTimes(1)
  })

  it('contains video loading errors inside the preview surface', () => {
    const errorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => undefined)
    renderPreview()

    fireEvent.error(screen.getByLabelText('demo clip.mp4'))

    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.video.load_error.title')
    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.load_error.description')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('/tmp/videos/demo clip.mp4'), expect.any(Error))
  })

  it('rebuilds the video element when the refresh key changes', () => {
    const { rerender } = renderPreview()
    const firstVideo = screen.getByLabelText('demo clip.mp4')

    rerender(<VideoFilePreview filePath={filePath} fileName="demo clip.mp4" metadata={{ size: 42 }} refreshKey={1} />)

    expect(screen.getByLabelText('demo clip.mp4')).not.toBe(firstVideo)
    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')
  })

  it('formats invalid and long durations for the control bar', () => {
    expect(formatVideoTime(Number.NaN)).toBe('0:00')
    expect(formatVideoTime(Infinity)).toBe('0:00')
    expect(formatVideoTime(65)).toBe('1:05')
    expect(formatVideoTime(3661)).toBe('1:01:01')
  })
})
