import type { FileMetadata } from '@renderer/types'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ImageUploader from '../../components/ImageUploader'
import PaintingsSectionTitle from '../../components/PaintingsSectionTitle'
import { generationModeType } from '../../model/types/paintingData'
import { clearDmxapiFileMap, getDmxapiFileMap, setDmxapiFileMap, subscribeDmxapiFileMap } from './runtime'

export const DmxapiSetting: FC<{
  mode: string
}> = ({ mode }) => {
  const { t } = useTranslation()
  const [, setTick] = useState(0)
  const isEditOrMerge = mode === generationModeType.EDIT || mode === generationModeType.MERGE

  useEffect(() => {
    return subscribeDmxapiFileMap(() => setTick((tick) => tick + 1))
  }, [])

  const handleAddImage = (file: File, index?: number) => {
    const path = URL.createObjectURL(file)

    setDmxapiFileMap((prev) => {
      const currentFiles = [...prev.imageFiles]
      const currentPaths = [...prev.paths]

      if (index !== undefined) {
        currentFiles[index] = file as unknown as FileMetadata
        currentPaths[index] = path
      } else {
        currentFiles.push(file as unknown as FileMetadata)
        currentPaths.push(path)
      }

      return { imageFiles: currentFiles, paths: currentPaths }
    })
  }

  const handleDeleteImage = (index: number) => {
    setDmxapiFileMap((prev) => {
      const newPaths = [...prev.paths]
      const newFiles = [...prev.imageFiles]
      newPaths.splice(index, 1)
      newFiles.splice(index, 1)
      return { imageFiles: newFiles, paths: newPaths }
    })
  }

  if (!isEditOrMerge) return null

  return (
    <>
      <PaintingsSectionTitle>{t('paintings.remix.image_file')}</PaintingsSectionTitle>
      <ImageUploader
        fileMap={getDmxapiFileMap()}
        maxImages={mode === generationModeType.EDIT ? 1 : 3}
        onClearImages={clearDmxapiFileMap}
        onDeleteImage={handleDeleteImage}
        onAddImage={handleAddImage}
        mode={mode}
      />
    </>
  )
}
