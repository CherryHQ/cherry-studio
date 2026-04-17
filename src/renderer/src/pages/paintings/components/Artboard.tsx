import { Button } from '@cherrystudio/ui'
import ImageViewer from '@renderer/components/ImageViewer'
import FileManager from '@renderer/services/FileManager'
import { motion } from 'framer-motion'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import type { PaintingData } from '../model/types/paintingData'

export interface ArtboardProps {
  painting: PaintingData
  isLoading: boolean
  currentImageIndex: number
  fallbackUrls?: string[]
  onPrevImage: () => void
  onNextImage: () => void
  onCancel: () => void
  retry?: (painting: PaintingData) => void
  imageCover?: React.ReactNode
  loadText?: React.ReactNode
}

const LoadingStateCard: FC<{ text: React.ReactNode; onCancel: () => void; cancelLabel: string }> = ({
  text,
  onCancel,
  cancelLabel
}) => {
  return (
    <div className="flex flex-col items-center gap-4 rounded-[18px] border border-border/70 bg-card/96 px-10 py-10 shadow-2xl shadow-black/10 backdrop-blur-sm">
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
      <div className="h-1.5 w-36 overflow-hidden rounded-full bg-muted/60">
        <motion.div
          className="h-full w-16 rounded-full bg-primary"
          animate={{ x: ['-110%', '170%'] }}
          transition={{ duration: 1.4, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
        />
      </div>
      <Button variant="outline" size="sm" onClick={onCancel} className="mt-1 min-w-20">
        {cancelLabel}
      </Button>
    </div>
  )
}

const Artboard: FC<ArtboardProps> = ({
  painting,
  isLoading,
  currentImageIndex,
  fallbackUrls = [],
  onPrevImage,
  onNextImage,
  onCancel,
  retry,
  imageCover,
  loadText
}) => {
  const { t } = useTranslation()
  const currentFile = painting.files[currentImageIndex]
  const currentImageUrl = currentFile ? FileManager.getFileUrl(currentFile) : ''
  const loadingText = loadText || t('paintings.generating')

  return (
    <div className="flex flex-1 items-center justify-center [--artboard-max:calc(100vh-256px)]">
      <div
        className={`relative flex h-full w-full items-center justify-center transition-opacity ${isLoading ? 'opacity-70' : 'opacity-100'}`}>
        {painting.files.length > 0 ? (
          <div className="relative flex items-center justify-center">
            {painting.files.length > 1 && (
              <Button
                size="icon-sm"
                variant="outline"
                onClick={onPrevImage}
                className="-translate-y-1/2 absolute top-1/2 left-2.5 z-20 opacity-80 hover:opacity-100">
                ←
              </Button>
            )}
            <ImageViewer
              src={currentImageUrl}
              preview={{ mask: false }}
              style={{
                maxWidth: 'var(--artboard-max)',
                maxHeight: 'var(--artboard-max)',
                objectFit: 'contain',
                backgroundColor: 'var(--color-background-soft)',
                cursor: 'pointer'
              }}
            />
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
              {currentImageIndex + 1} / {painting.files.length}
            </div>
          </div>
        ) : (
          <div className="flex h-[var(--artboard-max)] w-[var(--artboard-max)] items-center justify-center rounded-[18px] border border-border/40 bg-muted/20 p-6 text-center">
            {fallbackUrls.length > 0 && !isLoading ? (
              <div className="space-y-3">
                <ul className="select-text list-none break-all p-0 text-left">
                  {fallbackUrls.map((url, index) => (
                    <li key={url || index} className="mb-2 text-[var(--color-text-secondary)]">
                      {url}
                    </li>
                  ))}
                </ul>
                <div>
                  {t('paintings.proxy_required')}
                  {retry && (
                    <Button variant="ghost" onClick={() => retry?.(painting)}>
                      {t('paintings.image_retry')}
                    </Button>
                  )}
                </div>
              </div>
            ) : imageCover ? (
              imageCover
            ) : loadText && isLoading ? null : (
              <div className="text-muted-foreground">{t('paintings.image_placeholder')}</div>
            )}
          </div>
        )}

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
