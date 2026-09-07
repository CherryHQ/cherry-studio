import { createCanvas, loadImage } from '@napi-rs/canvas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateSelectionPng } from '../utils/generateBlob'

/**
 * jsdom ships no canvas implementation, so these run against a real rasteriser instead.
 * Only the Blob wrapper is stubbed — jsdom's Blob has no `arrayBuffer()`; the PNG encode
 * itself is real, which is the point: an assertion that "an image rendered" would not
 * notice an export that produces nothing.
 */
function makeCanvas(width: number, height: number) {
  const canvas = createCanvas(width, height)
  Object.defineProperty(canvas, 'toBlob', {
    value: (callback: (blob: Blob | null) => void) => {
      const bytes = new Uint8Array(canvas.encodeSync('png'))
      callback({ type: 'image/png', arrayBuffer: async () => bytes.buffer } as Blob)
    }
  })
  return canvas
}

/** A 400×300 source whose colours encode position, so a wrong crop offset is visible. */
async function makeSourceImage() {
  const canvas = createCanvas(400, 300)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 400, 300)
  // Exactly the physical crop region for selection {50,25,100,50} at scaleFactor 2.
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(100, 50, 200, 100)
  // Corner marker at the crop's own origin.
  ctx.fillStyle = '#0000ff'
  ctx.fillRect(100, 50, 10, 10)

  return (await loadImage(canvas.encodeSync('png'))) as unknown as HTMLImageElement
}

async function decode(pngBytes: Uint8Array) {
  const image = await loadImage(Buffer.from(pngBytes))
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  return {
    width: image.width,
    height: image.height,
    pixel(x: number, y: number) {
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data
      return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
    }
  }
}

describe('generateSelectionPng', () => {
  let createElement: typeof document.createElement

  beforeEach(() => {
    createElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: ElementCreationOptions) =>
      tag === 'canvas' ? makeCanvas(1, 1) : createElement(tag, options)) as typeof document.createElement)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exports a real PNG cropped at physical resolution', async () => {
    const bytes = await generateSelectionPng(await makeSourceImage(), { x: 50, y: 25, width: 100, height: 50 }, 2)

    // The PNG signature, so a plausible-looking empty buffer cannot pass.
    expect(Array.from(bytes.slice(0, 4))).toEqual([137, 80, 78, 71])

    const png = await decode(bytes)
    // Physical, not logical: exporting at CSS size would halve the detail on a 2× display.
    expect([png.width, png.height]).toEqual([200, 100])
    // The corner marker proves the crop started at the selection origin scaled up.
    expect(png.pixel(5, 5)).toBe('#0000ff')
    expect(png.pixel(150, 50)).toBe('#ff0000')
  })

  it('composites the annotation layer into the export', async () => {
    const annotationCanvas = makeCanvas(200, 100)
    const annotationCtx = annotationCanvas.getContext('2d')
    annotationCtx.fillStyle = '#00ff00'
    annotationCtx.fillRect(180, 80, 20, 20)

    const bytes = await generateSelectionPng(
      await makeSourceImage(),
      { x: 50, y: 25, width: 100, height: 50 },
      2,
      annotationCanvas as unknown as HTMLCanvasElement
    )

    const png = await decode(bytes)
    expect(png.pixel(190, 90)).toBe('#00ff00')
    // Everything outside the annotation still comes from the capture.
    expect(png.pixel(150, 50)).toBe('#ff0000')
  })

  it('skips a zero-sized annotation layer instead of throwing', async () => {
    // drawImage rejects a zero-sized source with InvalidStateError, which would abort
    // the whole export the moment the selection is dragged down to nothing.
    const bytes = await generateSelectionPng(
      await makeSourceImage(),
      { x: 50, y: 25, width: 100, height: 50 },
      2,
      makeCanvas(0, 0) as unknown as HTMLCanvasElement
    )
    expect(Array.from(bytes.slice(0, 4))).toEqual([137, 80, 78, 71])
  })
})
