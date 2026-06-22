import { Button } from '@cherrystudio/ui'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata } from '@renderer/types'
import { motion } from 'framer-motion'
import { type FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface VideoArtboardProps {
  files: FileMetadata[]
  isLoading: boolean
  onCancel: () => void
}

const LoadingStateCard: FC<{ text: string; onCancel: () => void; cancelLabel: string }> = ({
  text,
  onCancel,
  cancelLabel
}) => (
  <div className="flex min-w-56 flex-col items-center gap-4 rounded-[18px] border border-border-subtle bg-card/96 px-10 py-10 shadow-2xl backdrop-blur-sm">
    <div className="relative h-12 w-12">
      <motion.div
        className="absolute inset-0 rounded-full border-2 border-border"
        animate={{ rotate: 360 }}
        transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
      />
      <motion.div
        className="absolute inset-1 rounded-full border-2 border-primary border-r-transparent border-b-transparent"
        animate={{ rotate: -360 }}
        transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
      />
    </div>
    <div className="text-center font-medium text-[13px] text-foreground/85">{text}</div>
    <Button variant="outline" size="sm" onClick={onCancel} className="mt-1 min-w-20">
      {cancelLabel}
    </Button>
  </div>
)

/**
 * Video counterpart of the painting `Artboard`: renders the generated clip(s)
 * in a native `<video controls>` element (vs `<img>`), with prev/next nav when
 * a model returns more than one clip and the same spinner overlay while a job
 * runs. URLs come from `FileManager.getFileUrl` — the same path the image
 * Artboard uses, which works as a `<video src>` too.
 */
const VideoArtboard: FC<VideoArtboardProps> = ({ files, isLoading, onCancel }) => {
  const { t } = useTranslation()
  const [index, setIndex] = useState(0)
  const displayedIndex = files.length > 0 ? Math.min(index, files.length - 1) : 0
  const currentFile = files[displayedIndex]
  const currentUrl = currentFile ? FileManager.getFileUrl(currentFile) : ''

  const onPrev = useCallback(() => {
    setIndex((i) => (i > 0 ? i - 1 : Math.max(0, files.length - 1)))
  }, [files.length])
  const onNext = useCallback(() => {
    setIndex((i) => (files.length > 0 ? (i + 1) % files.length : 0))
  }, [files.length])

  useEffect(() => {
    setIndex(0)
  }, [currentFile?.id])

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col p-2">
      <div
        className={`relative flex min-h-0 flex-1 flex-col items-center justify-center transition-opacity ${isLoading ? 'opacity-70' : 'opacity-100'}`}>
        {files.length > 0 ? (
          <div className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden">
            {files.length > 1 && (
              <Button
                size="icon-sm"
                variant="outline"
                onClick={onPrev}
                aria-label={t('preview.previous')}
                className="-translate-y-1/2 absolute top-1/2 left-2.5 z-20 opacity-80 hover:opacity-100">
                ←
              </Button>
            )}
            <video
              key={currentFile.id}
              src={currentUrl}
              controls
              className="max-h-full max-w-full rounded-md bg-secondary object-contain">
              <track kind="captions" />
            </video>
            {files.length > 1 && (
              <Button
                size="icon-sm"
                variant="outline"
                onClick={onNext}
                aria-label={t('preview.next')}
                className="-translate-y-1/2 absolute top-1/2 right-2.5 z-20 opacity-80 hover:opacity-100">
                →
              </Button>
            )}
            {files.length > 1 && (
              <div className="-translate-x-1/2 absolute bottom-2.5 left-1/2 rounded-full bg-foreground/60 px-2 py-1 text-background text-xs">
                {displayedIndex + 1} / {files.length}
              </div>
            )}
          </div>
        ) : null}

        {isLoading && (
          <div className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 z-30">
            <LoadingStateCard text={t('paintings.generating')} onCancel={onCancel} cancelLabel={t('common.cancel')} />
          </div>
        )}
      </div>
    </div>
  )
}

export default VideoArtboard
