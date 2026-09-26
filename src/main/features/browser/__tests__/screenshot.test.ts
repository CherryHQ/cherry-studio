import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { captureScreenshot } from '../actions/screenshot'
import { GuestSession } from '../session/GuestSession'
import { createGuest } from './guestFixture'

let session: GuestSession
let mock: ReturnType<typeof createGuest>['mock']
let page: { x: number; y: number; width: number; height: number }
let viewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number }
let captures: Array<{
  clip: { x: number; y: number; width: number; height: number; scale: number }
  format: string
  quality?: number
}>
let dpr: number
let zoom: number
let afterMetrics: (() => void) | undefined
let payload: string | undefined
let afterCapture: (() => void) | undefined

beforeEach(() => {
  const fixture = createGuest()
  mock = fixture.mock
  session = new GuestSession(fixture.guest, 'managed')
  page = { x: 0, y: 0, width: 2004, height: 18538 }
  viewport = { pageX: 100, pageY: 400, clientWidth: 1049, clientHeight: 1637 }
  captures = []
  dpr = 2
  zoom = 1
  afterCapture = undefined
  afterMetrics = undefined
  payload = undefined
  Object.assign(mock, { getZoomFactor: () => zoom })
  vi.spyOn(session, 'resolveRef').mockImplementation((ref) => {
    if (ref !== 'e1') throw new Error('stale_ref')
    return 1
  })
  mock.debugger.sendCommand.mockImplementation(async (method, params: any) => {
    if (method === 'Page.getFrameTree')
      return { frameTree: { frame: { id: 'main', loaderId: session.documentId || 'document-1' } } }
    if (method === 'Page.getLayoutMetrics') {
      afterMetrics?.()
      return { cssContentSize: page, cssVisualViewport: viewport, cssLayoutViewport: viewport }
    }
    if (method === 'Page.createIsolatedWorld') return { executionContextId: 1 }
    if (method === 'Runtime.evaluate') return { result: { value: dpr } }
    if (method === 'DOM.resolveNode') return { object: { objectId: 'target' } }
    if (method === 'Runtime.callFunctionOn') return { result: { value: true } }
    if (method === 'DOM.getBoxModel') return { model: { border: [20, 30, 220, 30, 220, 110, 20, 110] } }
    if (method === 'Page.captureScreenshot') {
      captures.push(params)
      afterCapture?.()
      return { data: payload ?? Buffer.from(`image-${captures.length}`).toString('base64') }
    }
    if (method === 'DOM.scrollIntoViewIfNeeded' || method === 'Input.dispatchMouseEvent')
      throw new Error('Screenshots must not scroll or input')
    return {}
  })
})
afterEach(() => session.dispose())

const capture = (options = {}) => session.run(() => captureScreenshot(session, options, {}))

describe('Bounded browser screenshots', () => {
  it('returns the full page in bounded, ordered batches without gaps or duplicate tiles', async () => {
    let result = await capture({ fullPage: true })
    const images = [...result.images]
    expect(result.images).toHaveLength(4)
    expect(result.nextCursor).toBeTruthy()
    while (result.nextCursor) {
      result = await capture({ fullPage: true, cursor: result.nextCursor })
      expect(result.images.length).toBeLessThanOrEqual(4)
      images.push(...result.images)
    }
    expect(images).toHaveLength(result.totalTiles)
    expect(images.map((image) => image.index)).toEqual(Array.from({ length: images.length }, (_, index) => index))
    expect(images.reduce((sum, { region }) => sum + region.width * region.height, 0)).toBe(page.width * page.height)
    const rectangles = new Set(images.map(({ region }) => JSON.stringify(region)))
    expect(rectangles.size).toBe(images.length)
    for (const { clip } of captures) {
      expect(clip.width * clip.scale * dpr).toBeLessThanOrEqual(1440)
      expect(clip.height * clip.scale * dpr).toBeLessThanOrEqual(1440)
      expect(clip.width * clip.height * (clip.scale * dpr) ** 2).toBeLessThanOrEqual(1_600_000)
    }
  })

  it('preserves the scrolled viewport while bounding a high-DPI JPEG capture', async () => {
    zoom = 1.25
    dpr = 2.5
    const result = await capture({ format: 'jpeg', quality: 80 })
    expect(result.images).toHaveLength(1)
    expect(result.images[0].region).toEqual({ x: 100, y: 400, width: 1049, height: 1637 })
    expect(captures[0]).toMatchObject({
      format: 'jpeg',
      quality: 80,
      clip: { x: 125, y: 500, width: 1311.25, height: 2046.25 }
    })
    const { clip } = captures[0]
    expect(clip.width * clip.height * ((clip.scale * dpr) / zoom) ** 2).toBeLessThanOrEqual(1_600_000)
    expect((clip.height * clip.scale * dpr) / zoom).toBeCloseTo(1440)
  })

  it('crops a ref with context padding in document coordinates without scrolling', async () => {
    const result = await capture({ ref: 'e1' })
    expect(result.images[0].region).toEqual({ x: 108, y: 418, width: 224, height: 104 })
    expect(result.totalTiles).toBe(1)
    expect(captures[0].clip).toMatchObject({ x: 108, y: 418, width: 224, height: 104 })
  })

  it('rejects expired refs and cursors after navigation or layout size changes', async () => {
    await expect(capture({ ref: 'e2' })).rejects.toThrow('stale_ref')
    const first = await capture({ fullPage: true })
    captures.length = 0
    page.width += 100
    await expect(capture({ fullPage: true, cursor: first.nextCursor })).rejects.toThrow('page changed')
    page.width -= 100
    mock.debugger.emit('message', {}, 'Page.frameNavigated', { frame: { id: 'main', loaderId: 'new-document' } })
    await expect(capture({ fullPage: true, cursor: first.nextCursor })).rejects.toThrow('page changed')
    expect(captures).toHaveLength(0)
  })

  it('rejects layout metrics returned across a navigation boundary', async () => {
    afterMetrics = () =>
      mock.debugger.emit('message', {}, 'Page.frameNavigated', { frame: { id: 'main', loaderId: 'new-document' } })
    await expect(capture({ fullPage: true })).rejects.toThrow('stale_ref')
    expect(captures).toHaveLength(0)
  })

  it('continues from the first omitted tile when the response byte budget is reached', async () => {
    payload = 'x'.repeat(7 * 1024 * 1024)
    const first = await capture({ fullPage: true })
    expect(first.images.map((image) => image.index)).toEqual([0])
    const second = await capture({ fullPage: true, cursor: first.nextCursor })
    expect(second.images.map((image) => image.index)).toEqual([1])
  })

  it('discards a batch if navigation happens while capturing', async () => {
    afterCapture = () =>
      mock.debugger.emit('message', {}, 'Page.frameNavigated', { frame: { id: 'main', loaderId: 'new-document' } })
    await expect(capture({ fullPage: true })).rejects.toThrow('stale_ref')
    expect(captures).toHaveLength(1)
  })

  it('does not capture another tile after cancellation', async () => {
    const controller = new AbortController()
    afterCapture = () => controller.abort(new Error('cancelled'))
    await expect(
      session.run(() => captureScreenshot(session, { fullPage: true }, { signal: controller.signal }))
    ).rejects.toThrow('cancelled')
    expect(captures).toHaveLength(1)
  })

  it.each([{ fullPage: true, ref: 'e1' }, { cursor: 'bad' }])(
    'rejects conflicting scope options: %j',
    async (options) => {
      await expect(capture(options)).rejects.toThrow()
      expect(captures).toHaveLength(0)
    }
  )
})
