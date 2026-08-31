/**
 * Mosaic pixelation for the mosaic tool.
 *
 * Collects the blocks a brush path touches, then fills each with the colour of the
 * block's centre pixel read from the original capture.
 */

import { MOSAIC_BLOCK_SIZE } from '../constants'
import type { MosaicAnnotation, SelectionRect } from '../types'

/**
 * Pixelate along the brush path.
 *
 * Everything here — points, block grid, `selectionWidth`/`selectionHeight`, the
 * `fillRect` calls — is in selection-local LOGICAL pixels. Only the sampling index
 * into `imageData` converts to physical.
 */
export function drawMosaic(
  ctx: CanvasRenderingContext2D,
  annotation: MosaicAnnotation,
  imageData: ImageData,
  selectionWidth: number,
  selectionHeight: number,
  scaleFactor: number
): void {
  const blockSize = MOSAIC_BLOCK_SIZE
  // At least one block wide, or the stamps leave gaps along the path.
  const brushRadius = Math.max(annotation.strokeWidth * 2, blockSize)

  // Set-keyed by block index so overlapping stamps along the path are filled once.
  const affectedBlocks = new Set<string>()

  for (const point of annotation.points) {
    const minBx = Math.floor((point.x - brushRadius) / blockSize)
    const maxBx = Math.floor((point.x + brushRadius) / blockSize)
    const minBy = Math.floor((point.y - brushRadius) / blockSize)
    const maxBy = Math.floor((point.y + brushRadius) / blockSize)

    for (let bx = minBx; bx <= maxBx; bx++) {
      for (let by = minBy; by <= maxBy; by++) {
        const blockX = bx * blockSize
        const blockY = by * blockSize
        if (blockX + blockSize <= 0 || blockY + blockSize <= 0) continue
        if (blockX >= selectionWidth || blockY >= selectionHeight) continue
        affectedBlocks.add(`${bx},${by}`)
      }
    }
  }

  const imgW = imageData.width
  const data = imageData.data

  for (const key of affectedBlocks) {
    const [bxStr, byStr] = key.split(',')
    const blockX = Number(bxStr) * blockSize
    const blockY = Number(byStr) * blockSize

    const x0 = Math.max(0, blockX)
    const y0 = Math.max(0, blockY)
    const x1 = Math.min(selectionWidth, blockX + blockSize)
    const y1 = Math.min(selectionHeight, blockY + blockSize)
    if (x1 <= x0 || y1 <= y0) continue

    // Centre pixel of the clamped block, in physical coordinates. Blocks entirely
    // left of / above the selection were already dropped, so only the far edge needs a clamp.
    const sampleX = Math.min(Math.round(((x0 + x1) / 2) * scaleFactor), imageData.width - 1)
    const sampleY = Math.min(Math.round(((y0 + y1) / 2) * scaleFactor), imageData.height - 1)
    const idx = (sampleY * imgW + sampleX) * 4

    ctx.fillStyle = `rgb(${data[idx]},${data[idx + 1]},${data[idx + 2]})`
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
  }
}

/**
 * Render a mosaic whose points are stored in image-absolute coordinates.
 *
 * The caller has already applied `translate(-selection.x, -selection.y)`; this
 * re-applies the opposite translate AND re-bases the points, so the two cancel out
 * to identity — and that is the point. `drawMosaic` indexes `imageData` (which
 * covers the selection only, origin 0,0) with the very coordinates it draws at, so
 * both must be selection-local. Drop either half and the mosaic samples one place
 * while painting another, offset by exactly the selection origin.
 */
export function renderMosaicAbsolute(
  ctx: CanvasRenderingContext2D,
  annotation: MosaicAnnotation,
  imageData: ImageData,
  selection: SelectionRect,
  scaleFactor: number
): void {
  ctx.save()
  ctx.translate(selection.x, selection.y)
  const localAnnotation: MosaicAnnotation = {
    ...annotation,
    points: annotation.points.map((p) => ({ x: p.x - selection.x, y: p.y - selection.y }))
  }
  drawMosaic(ctx, localAnnotation, imageData, selection.width, selection.height, scaleFactor)
  ctx.restore()
}

/** The capture's pixels under the selection, as selection-local PHYSICAL px with origin (0,0). */
export function getSelectionImageData(
  image: HTMLImageElement,
  selection: SelectionRect,
  scaleFactor: number
): ImageData | null {
  const offscreen = document.createElement('canvas')
  const sw = Math.round(selection.width * scaleFactor)
  const sh = Math.round(selection.height * scaleFactor)
  offscreen.width = sw
  offscreen.height = sh
  const ctx = offscreen.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(
    image,
    Math.round(selection.x * scaleFactor),
    Math.round(selection.y * scaleFactor),
    sw,
    sh,
    0,
    0,
    sw,
    sh
  )
  return ctx.getImageData(0, 0, sw, sh)
}
