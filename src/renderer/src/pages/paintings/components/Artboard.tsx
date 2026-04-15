import { Button, Spinner } from '@cherrystudio/ui'
import ImageViewer from '@renderer/components/ImageViewer'
import FileManager from '@renderer/services/FileManager'
import type { Painting } from '@renderer/types'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

export interface ArtboardProps {
  painting: Painting
  isLoading: boolean
  currentImageIndex: number
  onPrevImage: () => void
  onNextImage: () => void
  onCancel: () => void
  retry?: (painting: Painting) => void
  imageCover?: React.ReactNode
  loadText?: React.ReactNode
}

const Artboard: FC<ArtboardProps> = ({
  painting,
  isLoading,
  currentImageIndex,
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

  return (
    <div className="flex flex-1 items-center justify-center [--artboard-max:calc(100vh-256px)]">
      <div
        className={`relative flex h-full w-full items-center justify-center transition-opacity ${isLoading ? 'opacity-50' : 'opacity-100'}`}>
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
          <div className="flex h-[var(--artboard-max)] w-[var(--artboard-max)] items-center justify-center bg-[var(--color-background-soft)] p-6 text-center">
            {painting.urls.length > 0 && !isLoading ? (
              <div className="space-y-3">
                <ul className="select-text list-none break-all p-0 text-left">
                  {painting.urls.map((url, index) => (
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
              <div>{t('paintings.image_placeholder')}</div>
            )}
          </div>
        )}

        {isLoading && (
          <div className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 z-30 flex flex-col items-center gap-5">
            <Spinner text="" />
            {loadText || null}
            <Button onClick={onCancel}>{t('common.cancel')}</Button>
          </div>
        )}
      </div>
    </div>
  )
}

export default Artboard
