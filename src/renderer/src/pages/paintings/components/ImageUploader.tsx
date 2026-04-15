import { Button, ConfirmDialog } from '@cherrystudio/ui'
import IcImageUp from '@renderer/assets/images/paintings/ic_ImageUp.svg'
import { useTheme } from '@renderer/context/ThemeProvider'
import type { FileMetadata } from '@renderer/types'
import { Trash2 } from 'lucide-react'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null)
  const imageFiles = fileMap.imageFiles || []

  const uploadSlots = useMemo(() => {
    const paths = fileMap.paths || []
    return paths.map((src, index) => ({ src, index }))
  }, [fileMap.paths])

  return (
    <>
      <div className="mb-2 flex items-center">
        {imageFiles.length > 0 && (
          <Button size="sm" onClick={onClearImages}>
            {t('common.clear_all')}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap">
        {uploadSlots.map(({ src, index }) => (
          <div key={index} className="relative mr-1 mb-1 h-[45%] w-[45%]">
            <label className="block h-full w-full cursor-pointer">
              <input
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) {
                    onAddImage(file, index)
                  }
                  event.target.value = ''
                }}
              />
              <div className="relative h-full w-full overflow-hidden rounded-md">
                <img
                  src={src}
                  alt={`${t('common.image_preview')} ${index + 1}`}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 hidden items-center justify-center bg-black/50 text-white hover:flex">
                  点击替换
                </div>
              </div>
            </label>

            <button
              type="button"
              onClick={() => setPendingDeleteIndex(index)}
              className="absolute top-1 right-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-80 transition-opacity hover:opacity-100">
              <Trash2 size={14} />
            </button>
          </div>
        ))}

        {imageFiles.length < maxImages && (
          <div className="relative mr-1 mb-1 h-[45%] w-[45%]">
            <label className="flex h-full w-full cursor-pointer items-center justify-center rounded-md border border-border border-dashed bg-muted/20 hover:bg-muted/30">
              <input
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) {
                    onAddImage(file)
                  }
                  event.target.value = ''
                }}
              />
              <img
                src={IcImageUp}
                alt={t('common.upload_image')}
                className="mt-2"
                style={{ filter: theme === 'dark' ? 'invert(100%)' : 'none' }}
              />
            </label>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingDeleteIndex !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteIndex(null)
          }
        }}
        title={t('paintings.button.delete.image.confirm')}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={() => {
          if (pendingDeleteIndex !== null) {
            onDeleteImage(pendingDeleteIndex)
          }
          setPendingDeleteIndex(null)
        }}
      />
    </>
  )
}

export default ImageUploader
