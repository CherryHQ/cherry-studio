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
  file: File
) {
  const path = URL.createObjectURL(file)
  setAihubmixUploadedFile(path, file)
  patchPainting({ [key]: path } as Partial<PaintingData>)
}

export function getAihubmixImagePreviewSrc(key: string, painting: PaintingData) {
  return painting[key as keyof PaintingData] as string | undefined
}
