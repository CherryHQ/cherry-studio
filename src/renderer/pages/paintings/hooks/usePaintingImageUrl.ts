import { useEffect, useState } from 'react'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { FileMetadata } from '@renderer/types/file'
import { createFileEntryHandle, normalizeExt } from '@shared/utils/file'

import { getPaintingFileUrl } from '../utils/paintingFileUrl'

const logger = loggerService.withContext('usePaintingImageUrl')

type PaintingImageUrlSource = Pick<FileMetadata, 'id' | 'path' | 'ext'>

type PaintingImageUrlResult = {
  url: string | undefined
  isLoading: boolean
}

export function usePaintingImageUrl(file: PaintingImageUrlSource | undefined): PaintingImageUrlResult {
  const svgFileId = file && normalizeExt(file.ext) === 'svg' ? file.id : undefined
  const [image, setImage] = useState<(PaintingImageUrlResult & { id: string }) | undefined>()

  useEffect(() => {
    if (svgFileId === undefined) {
      setImage(undefined)
      return
    }

    const file = { id: svgFileId }
    let active = true
    let objectUrl: string | undefined
    setImage({ id: file.id, url: undefined, isLoading: true })

    void (async () => {
      try {
        const { content } = await ipcApi.request('file.read', {
          handle: createFileEntryHandle(file.id),
          options: { mode: 'full', encoding: 'binary' }
        })
        if (!active) return

        const blob = new Blob([content.slice()], { type: 'image/svg+xml' })
        const url = URL.createObjectURL(blob)
        objectUrl = url
        setImage({ id: file.id, url, isLoading: false })
      } catch (error) {
        if (!active) return
        logger.warn('Failed to read painting SVG image', { fileId: file.id, error })
        setImage({ id: file.id, url: undefined, isLoading: false })
      }
    })()

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [svgFileId])

  if (!file) return { url: undefined, isLoading: false }
  if (svgFileId === undefined) return { url: getPaintingFileUrl(file), isLoading: false }
  if (image?.id !== svgFileId) return { url: undefined, isLoading: true }
  return { url: image.url, isLoading: image.isLoading }
}
