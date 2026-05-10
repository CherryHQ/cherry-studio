import { Button, Dialog, DialogContent } from '@cherrystudio/ui'
import FileManager from '@renderer/services/FileManager'
import { motion } from 'framer-motion'
import { type FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { PaintingData } from '../model/types/paintingData'

export interface ArtboardProps {
  painting: PaintingData
  isLoading: boolean
  onCancel: () => void
  imageCover?: React.ReactNode
  loadText?: React.ReactNode
}

const LoadingStateCard: FC<{ text: React.ReactNode; onCancel: () => void; cancelLabel: string }> = ({
  text,
  onCancel,
  cancelLabel
}) => {
  return (
    <div className="flex min-w-56 flex-col items-center gap-4 rounded-[18px] border border-border/70 bg-card/96 px-10 py-10 shadow-2xl shadow-black/10 backdrop-blur-sm">
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
}

const Artboard: FC<ArtboardProps> = ({ painting, isLoading, onCancel, imageCover, loadText }) => {
  const { t } = useTranslation()
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const displayedImageIndex = painting.files.length > 0 ? Math.min(currentImageIndex, painting.files.length - 1) : 0
  const currentFile = painting.files[displayedImageIndex]
  const currentImageUrl = currentFile ? FileManager.getFileUrl(currentFile) : ''
  const loadingText = loadText || t('paintings.generating')

  const onPrevImage = useCallback(() => {
    setCurrentImageIndex((index) => (index > 0 ? index - 1 : Math.max(0, painting.files.length - 1)))
  }, [painting.files.length])

  const onNextImage = useCallback(() => {
    setCurrentImageIndex((index) => (painting.files.length > 0 ? (index + 1) % painting.files.length : 0))
  }, [painting.files.length])

  useEffect(() => {
    setCurrentImageIndex(0)
    setLightboxOpen(false)
  }, [painting.id])

  useEffect(() => {
    setCurrentImageIndex((index) => {
      if (painting.files.length === 0) return 0
      return Math.min(index, painting.files.length - 1)
    })
  }, [painting.files.length])

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col p-2">
      <div
        className={`relative flex min-h-0 flex-1 flex-col items-center justify-center transition-opacity ${isLoading ? 'opacity-70' : 'opacity-100'}`}>
        {painting.files.length > 0 ? (
          <div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
            {painting.files.length > 1 && (
              <Button
                size="icon-sm"
                variant="outline"
                onClick={onPrevImage}
                className="-translate-y-1/2 absolute top-1/2 left-2.5 z-20 opacity-80 hover:opacity-100">
                ←
              </Button>
            )}
            <button
              type="button"
              className="flex max-h-full max-w-full items-center justify-center rounded-md outline-offset-2 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t('common.image_preview')}
              onClick={() => setLightboxOpen(true)}>
              <img
                src={currentImageUrl}
                alt=""
                className="max-h-[min(100%,calc(100vh-14rem))] max-w-full object-contain"
                style={{ backgroundColor: 'hsl(var(--muted) / 0.35)' }}
              />
            </button>
            <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
              <DialogContent
                showCloseButton
                className="max-h-[92vh] w-[min(96rem,calc(100vw-2rem))] max-w-[min(96rem,calc(100vw-2rem))] border-none bg-transparent p-2 shadow-none sm:max-w-[min(96rem,calc(100vw-2rem))]">
                <img
                  src={currentImageUrl}
                  alt=""
                  className="mx-auto max-h-[88vh] w-auto max-w-full object-contain"
                  style={{ backgroundColor: 'hsl(var(--muted) / 0.35)' }}
                />
              </DialogContent>
            </Dialog>
            {painting.files.length > 1 && (
              <Button
                size="icon-sm"
                variant="outline"
                onClick={onNextImage}
                className="-translate-y-1/2 absolute top-1/2 right-2.5 z-20 opacity-80 hover:opacity-100">
                →
              </Button>
            )}
            <div className="-translate-x-1/2 absolute bottom-2.5 left-1/2 rounded-full bg-black/50 px-2 py-1 text-white text-xs">
              {displayedImageIndex + 1} / {painting.files.length}
            </div>
          </div>
        ) : imageCover ? (
          imageCover
        ) : null}

        {isLoading && (
          <div className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 z-30">
            <LoadingStateCard text={loadingText} onCancel={onCancel} cancelLabel={t('common.cancel')} />
          </div>
        )}
      </div>
    </div>
  )
}

export default Artboard
