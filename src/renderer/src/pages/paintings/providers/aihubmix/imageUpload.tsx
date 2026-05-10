import IcImageUp from '@renderer/assets/images/paintings/ic_ImageUp.svg'

import type { AihubmixPaintingData as PaintingData } from '../../model/types/paintingData'

const fileStore = new Map<string, File>()

export function setAihubmixUploadedFile(path: string, file: File) {
  fileStore.set(path, file)
}

export function getAihubmixUploadedFile(path?: string | null) {
  if (!path) return null
  return fileStore.get(path) ?? null
}

export function createAihubmixImageUploadHandler(
  patchPainting: (updates: Partial<PaintingData>) => void,
  key: string,
  file: File,
  prevPath?: string | null
) {
  if (prevPath?.startsWith('blob:')) {
    URL.revokeObjectURL(prevPath)
  }
  const path = URL.createObjectURL(file)
  setAihubmixUploadedFile(path, file)
  patchPainting({ [key]: path } as Partial<PaintingData>)
}

export function getAihubmixImagePreviewSrc(key: string, painting: PaintingData) {
  return painting[key as keyof PaintingData] as string | undefined
}

export const aihubmixImagePlaceholder = <img src={IcImageUp} className="mt-2" />

export function handleAihubmixImageUpload(
  key: string,
  file: File,
  patchPainting: (updates: Partial<PaintingData>) => void,
  prevPath?: string | null
) {
  createAihubmixImageUploadHandler(patchPainting, key, file, prevPath)
}

export function getAihubmixPreviewSrc(key: string, painting: PaintingData) {
  return getAihubmixImagePreviewSrc(key, painting)
}
