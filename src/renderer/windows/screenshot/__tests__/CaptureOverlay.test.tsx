import { type Canvas, createCanvas, loadImage } from '@napi-rs/canvas'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ScreenshotInitData } from '@shared/types/screenshot'

import CaptureOverlay from '../CaptureOverlay'

vi.mock('@cherrystudio/ui', async () => ({
  ...(await import('@cherrystudio/ui/components/primitives/button')),
  ...(await import('@cherrystudio/ui/components/primitives/popover')),
  Textarea: await import('@cherrystudio/ui/components/primitives/textarea'),
  NormalTooltip: ({ children }: PropsWithChildren) => children
}))

const capture = (mediaId: string): ScreenshotInitData => ({
  mediaId,
  imageUrl: `cherry-media://image/${mediaId}`,
  display: { id: 1, x: 0, y: 0, width: 240, height: 160, scaleFactor: 1 },
  autoOcr: false,
  ocrAvailable: false
})

describe('capture export lifetime', () => {
  const browserGlobals = {
    Image: globalThis.Image,
    URL: globalThis.URL,
    fetch: globalThis.fetch,
    PointerEvent: globalThis.PointerEvent
  }
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  const encodings: Array<() => void> = []
  const outputs: Array<{ route: string; mediaId: string; pngBytes: Uint8Array }> = []
  let savePending: Promise<void> | undefined

  const emit = (event: string, payload?: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(payload)
  }

  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
    listeners.clear()
    encodings.length = 0
    outputs.length = 0
    savePending = undefined
    vi.spyOn(window.api.ipcApi, 'on').mockImplementation((event, callback) => {
      const entries = listeners.get(event) ?? new Set()
      entries.add(callback)
      listeners.set(event, entries)
      return () => {
        entries.delete(callback)
      }
    })
    vi.spyOn(window.api.ipcApi, 'request').mockImplementation(async (route, input) => {
      if (route === 'window.get_init_data') return { ok: true, data: capture('media-1') }
      if (route === 'screenshot.cancel') emit('screenshot.session_ended')
      if (['screenshot.save', 'screenshot.copy', 'screenshot.commit', 'screenshot.submit_result'].includes(route)) {
        outputs.push({ route, ...(input as { mediaId: string; pngBytes: Uint8Array }) })
        if (route === 'screenshot.save') await savePending
      }
      return { ok: true, data: undefined }
    })

    // jsdom lacks rasterization; retain the real PNG encoder and delay only its browser callback.
    const rasterizers = new WeakMap<HTMLCanvasElement, Canvas>()
    const rasterizer = (canvas: HTMLCanvasElement) => {
      let raster = rasterizers.get(canvas)
      if (!raster) {
        raster = createCanvas(canvas.width || 1, canvas.height || 1)
        rasterizers.set(canvas, raster)
      }
      if (raster.width !== canvas.width) raster.width = canvas.width || 1
      if (raster.height !== canvas.height) raster.height = canvas.height || 1
      return raster
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return rasterizer(this).getContext('2d') as unknown as CanvasRenderingContext2D
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
      const bytes = new Uint8Array(rasterizer(this).encodeSync('png'))
      encodings.push(() => callback({ arrayBuffer: async () => bytes.buffer } as Blob))
    })
    const source = createCanvas(240, 160)
    source.getContext('2d').fillRect(0, 0, 240, 160)
    const image = await loadImage(source.encodeSync('png'))
    Object.defineProperty(image, 'src', { configurable: true, get: () => '', set: () => {} })
    Object.defineProperty(image, 'decode', { value: async () => {} })
    vi.stubGlobal('Image', function () {
      return image
    })
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL() {
          return 'blob:capture-fixture'
        }
        static revokeObjectURL() {}
      }
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, blob: async () => new Blob() }))
    )
    vi.stubGlobal('PointerEvent', MouseEvent)
    Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', { configurable: true, value: () => {} })
    Object.defineProperty(HTMLCanvasElement.prototype, 'hasPointerCapture', { configurable: true, value: () => false })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    for (const [name, value] of Object.entries(browserGlobals)) vi.stubGlobal(name, value)
    Reflect.deleteProperty(HTMLCanvasElement.prototype, 'setPointerCapture')
    Reflect.deleteProperty(HTMLCanvasElement.prototype, 'hasPointerCapture')
  })

  async function selectCapture(container: HTMLElement, user: ReturnType<typeof userEvent.setup>) {
    // The drawable surface has no semantic role; buttons below use their accessible names.
    await waitFor(() => expect(container.querySelector('canvas')).not.toBeNull())
    const canvas = container.querySelector('canvas')!
    await user.pointer([
      { target: canvas, coords: { clientX: 10, clientY: 10 } },
      { keys: '[MouseLeft>]', target: canvas, coords: { clientX: 10, clientY: 10 } },
      { keys: '[/MouseLeft]', target: canvas, coords: { clientX: 10, clientY: 10 } }
    ])
    await screen.findByRole('button', { name: 'Save image' })
  }

  it('keeps export single-flight through both PNG encoding and the pending save request', async () => {
    const user = userEvent.setup()
    const { container } = render(<CaptureOverlay />)
    await selectCapture(container, user)
    let finishSave!: () => void
    savePending = new Promise<void>((resolve) => {
      finishSave = resolve
    })
    await user.dblClick(screen.getByRole('button', { name: 'Save image' }))
    expect(encodings).toHaveLength(1)
    expect(outputs).toEqual([])
    await act(async () => {
      encodings[0]()
    })
    expect(outputs.map(({ route, mediaId }) => ({ route, mediaId }))).toEqual([
      { route: 'screenshot.save', mediaId: 'media-1' }
    ])
    const png = await loadImage(Buffer.from(outputs[0].pngBytes))
    expect([png.width, png.height]).toEqual([240, 160])
    await user.click(screen.getByRole('button', { name: 'Copy to clipboard' }))
    expect(encodings).toHaveLength(1)
    await act(async () => {
      finishSave()
    })
    await user.click(screen.getByRole('button', { name: 'Copy to clipboard' }))
    expect(encodings).toHaveLength(2)
    await act(async () => {
      encodings[1]()
    })
    expect(outputs.map(({ route }) => route)).toEqual(['screenshot.save', 'screenshot.copy'])
  })

  it('drops a dismissed capture encoding without releasing a newer capture export', async () => {
    const user = userEvent.setup()
    const { container } = render(<CaptureOverlay />)
    await selectCapture(container, user)
    await user.click(screen.getByRole('button', { name: 'Save image' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: 'Save image' })).not.toBeInTheDocument()
    await act(async () => {
      emit('window.reused', capture('media-2'))
    })
    await selectCapture(container, user)
    await user.click(screen.getByRole('button', { name: 'Save image' }))
    expect(encodings).toHaveLength(2)
    await act(async () => {
      encodings[0]()
    })
    expect(outputs).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Save image' }))
    expect(encodings).toHaveLength(2)
    await act(async () => {
      encodings[1]()
    })
    expect(outputs.map(({ route, mediaId }) => ({ route, mediaId }))).toEqual([
      { route: 'screenshot.save', mediaId: 'media-2' }
    ])
    const png = await loadImage(Buffer.from(outputs[0].pngBytes))
    expect([png.width, png.height]).toEqual([240, 160])
  })
})
