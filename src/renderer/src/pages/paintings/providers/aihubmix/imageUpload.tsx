import IcImageUp from '@renderer/assets/images/paintings/ic_ImageUp.svg'

import type { GeneratePaintingData as PaintingData } from '../../model/types/paintingData'
import { createAihubmixImageUploadHandler, getAihubmixImagePreviewSrc } from './runtime'

export const aihubmixImagePlaceholder = <img src={IcImageUp} className="mt-2" />

export function handleAihubmixImageUpload(
  key: string,
  file: File,
  patchPainting: (updates: Partial<PaintingData>) => void
) {
  createAihubmixImageUploadHandler(patchPainting, key, file)
}

export function getAihubmixPreviewSrc(key: string, painting: PaintingData) {
  return getAihubmixImagePreviewSrc(key, painting)
}
