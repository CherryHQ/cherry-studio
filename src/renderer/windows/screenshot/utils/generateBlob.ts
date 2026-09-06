import type { SelectionRect } from '../types'

/**
 * Crop the capture to the selection, composite the annotation layer, and encode a PNG.
 *
 * Crops at PHYSICAL resolution so the export keeps the display's full detail; the
 * selection arrives in logical pixels and is scaled here.
 *
 * `image` must be decoded from a same-origin source (a blob object URL). Handing it
 * an image loaded straight from a custom protocol taints the canvas and makes the
 * encode below throw `SecurityError` — which presents as "the overlay looks right
 * but Copy and Save do nothing".
 */
export async function generateSelectionPng(
  image: HTMLImageElement,
  selection: SelectionRect,
  scaleFactor: number,
  annotationCanvas?: HTMLCanvasElement | null
): Promise<Uint8Array> {
  const sx = Math.round(selection.x * scaleFactor)
  const sy = Math.round(selection.y * scaleFactor)
  const sw = Math.round(selection.width * scaleFactor)
  const sh = Math.round(selection.height * scaleFactor)

  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get a 2d context for the screenshot export')

  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh)

  // `drawImage` throws `InvalidStateError` on a zero-sized source, so the size guard is not
  // cosmetic; the explicit sw/sh destination rescales an annotation layer that rounded differently.
  if (annotationCanvas && annotationCanvas.width > 0 && annotationCanvas.height > 0) {
    ctx.drawImage(annotationCanvas, 0, 0, sw, sh)
  }

  // toBlob rather than toDataURL: the encode of a full-resolution capture is not free,
  // and only this form keeps it off the frame the user is still interacting with.
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result)
      else reject(new Error('Failed to encode the screenshot canvas'))
    }, 'image/png')
  })

  // Bytes, not a data URL: Electron structured-clones a Uint8Array over IPC as-is, so
  // base64 would only add a third to the payload plus an encode here and a decode in main.
  return new Uint8Array(await blob.arrayBuffer())
}
