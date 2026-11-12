import { createCanvas } from '@napi-rs/canvas'
import { render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { TranslationCanvas } from '../components/TranslationCanvas'
import type { TranslationBlock } from '../types'

afterEach(() => vi.restoreAllMocks())

it('paints only completed replacements in a physical-sized canvas and hides the layer', () => {
  let raster = createCanvas(1, 1)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    raster = createCanvas(this.width, this.height)
    return raster.getContext('2d') as never
  })
  const box = { x: 2, y: 2, width: 12, height: 12 }
  const blocks: TranslationBlock[] = [
    {
      id: 0,
      sourceText: 'source',
      originalBox: box,
      box,
      detectedLanguage: 'en',
      status: 'succeeded',
      translatedText: 'x',
      drawing: { background: { r: 255, g: 0, b: 0 }, fontSizePx: 6, baselineX: 3, baselineY: 9 }
    },
    {
      id: 1,
      sourceText: 'failed',
      originalBox: { ...box, x: 20 },
      box: { ...box, x: 20 },
      detectedLanguage: 'en',
      status: 'failed'
    }
  ]
  const { container } = render(
    <TranslationCanvas
      selection={{ x: 1, y: 2, width: 20, height: 10 }}
      scaleFactor={2}
      blocks={blocks}
      visible={false}
    />
  )
  const canvas = container.querySelector('canvas')!
  expect([canvas.width, canvas.height]).toEqual([40, 20])
  expect(canvas).toHaveStyle({ visibility: 'hidden', left: '1px', top: '2px' })
  expect(Array.from(raster.getContext('2d').getImageData(2, 2, 1, 1).data)).toEqual([255, 0, 0, 255])
  expect(raster.getContext('2d').getImageData(20, 2, 1, 1).data[3]).toBe(0)
})
