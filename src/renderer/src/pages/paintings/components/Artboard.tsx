import { Button } from '@cherrystudio/ui'
import ImageViewer from '@renderer/components/ImageViewer'
import FileManager from '@renderer/services/FileManager'
import type { Painting } from '@renderer/types'
import { Spin } from 'antd'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

interface ArtboardProps {
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

  const getCurrentImageUrl = () => {
    const currentFile = painting.files[currentImageIndex]
    return currentFile ? FileManager.getFileUrl(currentFile) : ''
  }

  return (
    <div className="flex flex-1 flex-row items-center justify-center [--artboard-max:calc(100vh-256px)]">
      <div
        className={`relative flex h-full w-full items-center justify-center transition-opacity duration-300 ${
          isLoading ? 'opacity-50' : 'opacity-100'
        }`}>
        {painting.files.length > 0 ? (
          <div className="[&_.ant-spin-spinning]:-translate-x-1/2 [&_.ant-spin-spinning]:-translate-y-1/2 relative flex items-center justify-center [&_.ant-spin-spinning]:absolute [&_.ant-spin-spinning]:top-1/2 [&_.ant-spin-spinning]:left-1/2 [&_.ant-spin-spinning]:z-3 [&_.ant-spin]:max-h-none">
            {painting.files.length > 1 && (
              <Button
                onClick={onPrevImage}
                className="-translate-y-1/2 absolute top-1/2 left-2.5 z-2 opacity-70 hover:opacity-100">
                ←
              </Button>
            )}
            <ImageViewer
              src={getCurrentImageUrl()}
              preview={{ mask: false }}
              style={{
                maxWidth: 'var(--artboard-max)',
                maxHeight: 'var(--artboard-max)',
                objectFit: 'contain',
                backgroundColor: 'var(--color-background-subtle)',
                cursor: 'pointer'
              }}
            />
            {painting.files.length > 1 && (
              <Button
                onClick={onNextImage}
                className="-translate-y-1/2 absolute top-1/2 right-2.5 z-2 opacity-70 hover:opacity-100">
                →
              </Button>
            )}
            <div className="-translate-x-1/2 absolute bottom-2.5 left-1/2 rounded-xl bg-black/50 px-2 py-1 text-white text-xs">
              {currentImageIndex + 1} / {painting.files.length}
            </div>
          </div>
        ) : (
          <div className="box-border flex h-(--artboard-max) w-(--artboard-max) items-center justify-center bg-background-subtle p-6">
            {painting.urls.length > 0 && retry ? (
              <div>
                <ul className="m-0 select-text list-none break-all p-0">
                  {painting.urls.map((url, index) => (
                    <li key={url || index} className="mb-2.5 text-foreground-secondary">
                      {url}
                    </li>
                  ))}
                </ul>
                <div>
                  {t('paintings.proxy_required')}
                  <Button variant="ghost" onClick={() => retry?.(painting)}>
                    {t('paintings.image_retry')}
                  </Button>
                </div>
              </div>
            ) : imageCover ? (
              imageCover
            ) : loadText && isLoading ? (
              ''
            ) : (
              <div>{t('paintings.image_placeholder')}</div>
            )}
          </div>
        )}
        {isLoading && (
          <div className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 flex flex-col items-center gap-5">
            <Spin size="large" />
            {loadText ? loadText : ''}
            <Button onClick={onCancel} className="z-1001 mt-2.5">
              {t('common.cancel')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export default Artboard
