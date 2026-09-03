import {
  Button,
  EmptyState,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Slider,
  Tooltip
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { cn } from '@renderer/utils/style'
import { toFileUrl } from '@shared/utils/file'
import FileWarning from 'lucide-react/dist/esm/icons/file-warning'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle'
import Maximize2 from 'lucide-react/dist/esm/icons/maximize-2'
import Minimize2 from 'lucide-react/dist/esm/icons/minimize-2'
import Pause from 'lucide-react/dist/esm/icons/pause'
import Play from 'lucide-react/dist/esm/icons/play'
import Volume1 from 'lucide-react/dist/esm/icons/volume-1'
import Volume2 from 'lucide-react/dist/esm/icons/volume-2'
import VolumeX from 'lucide-react/dist/esm/icons/volume-x'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FilePreviewLayout } from '../../FilePreviewLayout'
import type { FilePreviewPluginProps } from '../../types'

const logger = loggerService.withContext('VideoFilePreview')
const PLAYBACK_RATE_OPTIONS = [0.5, 1, 1.25, 1.5, 2] as const
const VIDEO_MENU_ITEM_CLASS = 'text-white hover:bg-white/15 hover:text-white data-[active=true]:bg-white/20'
const VIDEO_SLIDER_CLASS = cn(
  'h-6 min-w-0 flex-1',
  '[&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-track]]:bg-white/40',
  '[&_[data-slot=slider-range]]:bg-white',
  '[&_[data-slot=slider-thumb]]:size-4 [&_[data-slot=slider-thumb]]:border-black/30 [&_[data-slot=slider-thumb]]:bg-white'
)

function getFiniteSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function formatVideoTime(value: number): string {
  const totalSeconds = Math.floor(getFiniteSeconds(value))
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export default function VideoFilePreview({ filePath, fileName, refreshKey }: FilePreviewPluginProps) {
  const { t } = useTranslation()
  const videoShellRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const lastVolumeRef = useRef(1)
  const [videoShellElement, setVideoShellElement] = useState<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<'error' | 'loading' | 'ready'>('loading')
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [muted, setMuted] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false)
  const [volume, setVolume] = useState(1)
  const [volumeMenuOpen, setVolumeMenuOpen] = useState(false)
  const src = useMemo(() => toFileUrl(filePath), [filePath])
  const setVideoShell = useCallback((element: HTMLDivElement | null) => {
    videoShellRef.current = element
    setVideoShellElement(element)
  }, [])
  const markReady = useCallback(() => {
    const video = videoRef.current
    if (video) {
      setCurrentTime(getFiniteSeconds(video.currentTime))
      setDuration(getFiniteSeconds(video.duration))
      const nextVolume = Math.min(1, Math.max(0, video.volume))
      setVolume(nextVolume)
      setMuted(video.muted || nextVolume === 0)
      if (nextVolume > 0) lastVolumeRef.current = nextVolume
    }
    setStatus('ready')
  }, [])

  useEffect(() => {
    setStatus('loading')
    setCurrentTime(0)
    setDuration(0)
    setFullscreen(false)
    setMuted(false)
    setPlaying(false)
    setPlaybackRate(1)
    setSpeedMenuOpen(false)
    setVolume(1)
    setVolumeMenuOpen(false)
    lastVolumeRef.current = 1
    const frame = window.requestAnimationFrame(() => {
      if (!videoRef.current) return
      videoRef.current.playbackRate = 1
      videoRef.current.volume = 1
      videoRef.current.muted = false
      if (videoRef.current.readyState >= HTMLMediaElement.HAVE_METADATA) markReady()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [filePath, markReady, refreshKey])

  useEffect(() => {
    if (videoRef.current && videoRef.current.readyState >= HTMLMediaElement.HAVE_METADATA) markReady()
  }, [filePath, markReady, refreshKey])

  useEffect(() => {
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === videoShellRef.current)
    document.addEventListener('fullscreenchange', syncFullscreen)
    return () => document.removeEventListener('fullscreenchange', syncFullscreen)
  }, [])

  const syncTime = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    setCurrentTime(getFiniteSeconds(video.currentTime))
    setDuration(getFiniteSeconds(video.duration))
  }, [])

  const togglePlayback = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    if (video.paused) {
      const playPromise = video.play()
      if (playPromise) {
        playPromise.catch((error: unknown) =>
          logger.warn('Video playback was interrupted', error instanceof Error ? error : { error: String(error) })
        )
      }
      setPlaying(true)
      return
    }

    video.pause()
    setPlaying(false)
  }, [])

  const toggleMuted = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    if (video.muted || video.volume === 0) {
      const restoredVolume = lastVolumeRef.current || 1
      video.volume = restoredVolume
      video.muted = false
      setVolume(restoredVolume)
      setMuted(false)
      return
    }

    lastVolumeRef.current = video.volume || lastVolumeRef.current
    video.muted = true
    setMuted(true)
  }, [])

  const changeVolume = useCallback((value: number) => {
    const video = videoRef.current
    if (!video) return
    const nextVolume = Math.min(1, Math.max(0, value))
    video.volume = nextVolume
    video.muted = nextVolume === 0
    setVolume(nextVolume)
    setMuted(video.muted)
    if (nextVolume > 0) lastVolumeRef.current = nextVolume
  }, [])

  const seek = useCallback((value: number) => {
    const video = videoRef.current
    if (!video) return
    const nextTime = Math.min(getFiniteSeconds(video.duration), getFiniteSeconds(value))
    video.currentTime = nextTime
    setCurrentTime(nextTime)
  }, [])

  const changePlaybackRate = useCallback((rate: number) => {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = rate
    setPlaybackRate(rate)
    setSpeedMenuOpen(false)
  }, [])

  const toggleFullscreen = useCallback(() => {
    const shell = videoShellRef.current
    if (!shell) return

    const fullscreenPromise =
      document.fullscreenElement === shell ? document.exitFullscreen() : shell.requestFullscreen()
    fullscreenPromise.catch((error: unknown) =>
      logger.warn('Video fullscreen request failed', error instanceof Error ? error : { error: String(error) })
    )
  }, [])

  if (status === 'error') {
    return (
      <FilePreviewLayout.Frame>
        <FilePreviewLayout.Content>
          <div role="alert" className="h-full">
            <EmptyState
              icon={FileWarning}
              title={t('file_preview.video.load_error.title')}
              description={t('file_preview.load_error.description')}
              className="h-full"
            />
          </div>
        </FilePreviewLayout.Content>
      </FilePreviewLayout.Frame>
    )
  }

  return (
    <FilePreviewLayout.Frame>
      <FilePreviewLayout.Content composerInset={false}>
        <div className="relative flex h-full min-h-full min-w-full items-center justify-center overflow-hidden p-4">
          {status === 'loading' && (
            <div
              role="status"
              className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground text-sm">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              <span>{t('file_preview.loading')}</span>
            </div>
          )}
          <div
            ref={setVideoShell}
            data-testid="video-preview-shell"
            className={cn(
              'relative flex h-full w-full items-center justify-center overflow-hidden bg-black',
              fullscreen ? 'rounded-none' : 'rounded-md'
            )}>
            <video
              ref={videoRef}
              key={`${filePath}:${refreshKey}`}
              aria-label={fileName}
              className="block h-full w-full object-contain"
              disablePictureInPicture
              disableRemotePlayback
              preload="metadata"
              src={src}
              onCanPlay={markReady}
              onDurationChange={syncTime}
              onEnded={() => setPlaying(false)}
              onLoadedData={markReady}
              onLoadedMetadata={markReady}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
              onTimeUpdate={syncTime}
              onVolumeChange={() => {
                const video = videoRef.current
                if (!video) return
                const nextVolume = Math.min(1, Math.max(0, video.volume))
                setVolume(nextVolume)
                setMuted(video.muted || nextVolume === 0)
                if (nextVolume > 0) lastVolumeRef.current = nextVolume
              }}
              onError={() => {
                const error = new Error(`Failed to load video preview: ${filePath}`)
                logger.error(`Failed to load video preview: ${filePath}`, error)
                setStatus('error')
              }}
            />
            {status === 'ready' && (
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pb-2 pt-7 text-white">
                <div className="flex items-center gap-2">
                  <Tooltip content={playing ? t('file_preview.video.pause') : t('file_preview.video.play')} delay={300}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={playing ? t('file_preview.video.pause') : t('file_preview.video.play')}
                      className="size-7 shrink-0 text-white hover:bg-white/15 hover:text-white"
                      onClick={togglePlayback}>
                      {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
                    </Button>
                  </Tooltip>
                  <span className="w-[86px] shrink-0 text-center font-medium text-[11px] tabular-nums text-white/90">
                    {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
                  </span>
                  <Slider
                    aria-label={t('file_preview.video.seek')}
                    value={[Math.min(currentTime, duration)]}
                    min={0}
                    max={duration || 0}
                    step={0.1}
                    className={VIDEO_SLIDER_CLASS}
                    getThumbAriaLabel={() => t('file_preview.video.seek')}
                    getThumbAriaValueText={(value) => formatVideoTime(value)}
                    onValueChange={([value]) => seek(value)}
                  />
                  <Popover open={speedMenuOpen} onOpenChange={setSpeedMenuOpen}>
                    <Tooltip content={t('file_preview.video.speed')} delay={300}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={t('file_preview.video.speed')}
                          className="h-7 shrink-0 px-2 font-medium text-[11px] text-white hover:bg-white/15 hover:text-white">
                          {playbackRate}x
                        </Button>
                      </PopoverTrigger>
                    </Tooltip>
                    <PopoverContent
                      align="end"
                      side="top"
                      sideOffset={8}
                      portalContainer={videoShellElement ?? undefined}
                      className="z-[90] w-28 border-white/15 bg-black/90 p-1 text-white shadow-lg">
                      <MenuList className="gap-0">
                        {PLAYBACK_RATE_OPTIONS.map((rate) => (
                          <MenuItem
                            key={rate}
                            active={playbackRate === rate}
                            label={t('file_preview.video.speed_option', { speed: `${rate}x` })}
                            className={VIDEO_MENU_ITEM_CLASS}
                            size="sm"
                            onClick={() => changePlaybackRate(rate)}
                          />
                        ))}
                      </MenuList>
                    </PopoverContent>
                  </Popover>
                  <Popover open={volumeMenuOpen} onOpenChange={setVolumeMenuOpen}>
                    <Tooltip content={t('file_preview.video.volume')} delay={300}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('file_preview.video.volume')}
                          className="size-7 shrink-0 text-white hover:bg-white/15 hover:text-white">
                          {muted || volume === 0 ? (
                            <VolumeX className="size-4" aria-hidden />
                          ) : volume < 0.5 ? (
                            <Volume1 className="size-4" aria-hidden />
                          ) : (
                            <Volume2 className="size-4" aria-hidden />
                          )}
                        </Button>
                      </PopoverTrigger>
                    </Tooltip>
                    <PopoverContent
                      align="center"
                      side="top"
                      sideOffset={8}
                      portalContainer={videoShellElement ?? undefined}
                      className="z-[90] w-32 border-white/15 bg-black/90 p-3 text-white shadow-lg">
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={muted ? t('file_preview.video.unmute') : t('file_preview.video.mute')}
                          className="size-6 shrink-0 text-white hover:bg-white/15 hover:text-white"
                          onClick={toggleMuted}>
                          {muted || volume === 0 ? (
                            <VolumeX className="size-4" aria-hidden />
                          ) : volume < 0.5 ? (
                            <Volume1 className="size-4" aria-hidden />
                          ) : (
                            <Volume2 className="size-4" aria-hidden />
                          )}
                        </Button>
                        <Slider
                          aria-label={t('file_preview.video.volume')}
                          value={[muted ? 0 : volume]}
                          min={0}
                          max={1}
                          step={0.01}
                          className={VIDEO_SLIDER_CLASS}
                          getThumbAriaLabel={() => t('file_preview.video.volume')}
                          getThumbAriaValueText={(value) =>
                            t('file_preview.video.volume_percent', { volume: Math.round(value * 100) })
                          }
                          onValueChange={([value]) => changeVolume(value)}
                        />
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Tooltip
                    content={fullscreen ? t('file_preview.video.exit_fullscreen') : t('file_preview.video.fullscreen')}
                    delay={300}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={
                        fullscreen ? t('file_preview.video.exit_fullscreen') : t('file_preview.video.fullscreen')
                      }
                      className="size-7 shrink-0 text-white hover:bg-white/15 hover:text-white"
                      onClick={toggleFullscreen}>
                      {fullscreen ? (
                        <Minimize2 className="size-4" aria-hidden />
                      ) : (
                        <Maximize2 className="size-4" aria-hidden />
                      )}
                    </Button>
                  </Tooltip>
                </div>
              </div>
            )}
          </div>
        </div>
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}
