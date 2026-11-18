/** Layout math for PPTD image elements: crop then fit, per the reference. */

import type { PptdImageCrop, PptdImageFit } from './pptdFormat'

export interface PptdImageRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Computes where the source image sits inside a W x H box after crop
 * (proportional source-rectangle adjustment, negative values expand) and fit
 * (cover/contain/fill of the cropped sub-image into the box).
 */
export function pptdImageRect(
  naturalWidth: number,
  naturalHeight: number,
  boxWidth: number,
  boxHeight: number,
  crop: PptdImageCrop | undefined,
  fit: PptdImageFit | undefined
): PptdImageRect | null {
  if (naturalWidth <= 0 || naturalHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) return null
  const left = crop?.left ?? 0
  const top = crop?.top ?? 0
  const right = crop?.right ?? 0
  const bottom = crop?.bottom ?? 0
  const subW = naturalWidth * (1 - left - right)
  const subH = naturalHeight * (1 - top - bottom)
  if (subW <= 0 || subH <= 0) return null
  const mode = fit?.mode ?? 'cover'
  // The + 0 normalizes -0 so callers can compare rects structurally.
  if (mode === 'fill') {
    const scaleX = boxWidth / subW
    const scaleY = boxHeight / subH
    return {
      x: -left * naturalWidth * scaleX + 0,
      y: -top * naturalHeight * scaleY + 0,
      width: naturalWidth * scaleX,
      height: naturalHeight * scaleY
    }
  }
  const scale =
    mode === 'contain' ? Math.min(boxWidth / subW, boxHeight / subH) : Math.max(boxWidth / subW, boxHeight / subH)
  const width = naturalWidth * scale
  const height = naturalHeight * scale
  return {
    x: (boxWidth - width) / 2 - left * naturalWidth * scale + 0,
    y: (boxHeight - height) / 2 - top * naturalHeight * scale + 0,
    width,
    height
  }
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp'
}

export function pptdMediaMime(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
}
