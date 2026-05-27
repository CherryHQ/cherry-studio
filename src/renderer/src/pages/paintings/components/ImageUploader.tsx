import { Button } from '@cherrystudio/ui'
import IcImageUp from '@renderer/assets/images/paintings/ic_ImageUp.svg'
import { useTheme } from '@renderer/context/ThemeProvider'
import type { FileMetadata } from '@renderer/types'
import { Trash2 } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmAction, FilePicker } from './PaintingControls'

interface ImageUploaderProps {
  fileMap: {
    imageFiles?: FileMetadata[]
    paths?: string[]
  }
  maxImages: number
  onClearImages: () => void
  onDeleteImage: (index: number) => void
  onAddImage: (file: File, index?: number) => void
  mode: string
}

const ImageUploader: React.FC<ImageUploaderProps> = ({
  fileMap,
  maxImages,
  onClearImages,
  onDeleteImage,
  onAddImage
}) => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const imageCount = fileMap.imageFiles?.length || 0
  const remainingImages = Math.max(maxImages - imageCount, 0)

  const handleBeforeUpload = (file: File, index?: number) => {
    onAddImage(file, index)
  }

  return (
    <>
      <div className="mb-2.5 flex items-center">
        {fileMap.imageFiles && fileMap.imageFiles.length > 0 && (
          <Button size="sm" onClick={onClearImages}>
            {t('common.clear_all')}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap">
        {fileMap.paths && fileMap.paths.length > 0 ? (
          <>
            {fileMap.paths.map((src, index) => (
              <div key={index} className="relative mr-1.25 mb-1.25 h-[45%] w-[45%]">
                <FilePicker
                  className="mb-1.25 block aspect-square h-full w-full"
                  accept="image/png, image/jpeg"
                  multiple={false}
                  onFiles={(files) => {
                    const file = files[0]
                    if (file) {
                      handleBeforeUpload(file, index)
                    }
                  }}>
                  <div className="group relative h-full w-full overflow-hidden rounded-md">
                    <img
                      src={src}
                      alt={`${t('common.image_preview')} ${index + 1}`}
                      className="h-full w-full object-cover"
                    />
                    <div className="pointer-events-none absolute inset-0 flex cursor-pointer items-center justify-center bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
                      {t('common.click_to_replace')}
                    </div>
                  </div>
                </FilePicker>
                <ConfirmAction
                  title={t('paintings.button.delete.image.confirm')}
                  cancelText={t('common.cancel')}
                  confirmText={t('common.confirm')}
                  destructive
                  onConfirm={() => onDeleteImage(index)}>
                  <button
                    type="button"
                    className="absolute top-1.25 right-1.25 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-0 bg-black/60 text-white opacity-70 transition-opacity duration-300 ease-in-out hover:opacity-100">
                    <Trash2 className="size-3.5" />
                  </button>
                </ConfirmAction>
              </div>
            ))}
          </>
        ) : (
          ''
        )}

        {remainingImages > 0 ? (
          <div className="relative mr-1.25 mb-1.25 h-[45%] w-[45%]">
            <FilePicker
              className="mb-1.25 flex aspect-square h-full w-full items-center justify-center rounded-md border border-border border-dashed bg-background-subtle hover:bg-muted"
              multiple={remainingImages > 1}
              accept="image/png, image/jpeg"
              onFiles={(files) => {
                files.slice(0, remainingImages).forEach((file) => handleBeforeUpload(file))
              }}>
              <img src={IcImageUp} alt="" className={theme === 'dark' ? 'mt-2 invert' : 'mt-2'} />
            </FilePicker>
          </div>
        ) : (
          ''
        )}
      </div>
    </>
  )
}

export default ImageUploader
