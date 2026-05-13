import IcImageUp from '@renderer/assets/images/paintings/ic_ImageUp.svg'
import { convertToBase64 } from '@renderer/utils'

import type { PpioPaintingData as PaintingData } from '../../model/types/paintingData'

export const ppioImagePlaceholder = <img src={IcImageUp} className="mt-2" />

export function handlePpioImageUpload(
  key: string,
  file: File,
  patchPainting: (updates: Partial<PaintingData>) => void
) {
  void convertToBase64(file).then((base64Image) => {
    if (typeof base64Image === 'string') {
      patchPainting({ [key]: base64Image } as Partial<PaintingData>)
    }
  })
}

export function getPpioPreviewSrc(key: string, painting: PaintingData) {
  const value = painting[key as keyof PaintingData]
  return typeof value === 'string' ? value : undefined
}
