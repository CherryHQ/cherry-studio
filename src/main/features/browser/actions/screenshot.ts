import type { Protocol } from 'devtools-protocol'
import * as z from 'zod'

import { browserRefSchema, type CommandOptions } from '../browserUse'
import { BrowserSessionError } from '../session/BrowserSessionError'
import type { GuestSession } from '../session/GuestSession'
import { withElement } from './resolveTarget'

const MAX_SIDE = 1440
const MAX_PIXELS = 1_600_000
const MAX_IMAGES = 4
const MAX_BASE64_BYTES = 12 * 1024 * 1024

export const screenshotOptionsSchema = z.object({
  fullPage: z.boolean().optional().describe('Return full-page tiles without scrolling, up to four images per call'),
  ref: browserRefSchema.optional().describe('Crop around a current snapshot ref without scrolling'),
  cursor: z.string().max(2048).optional().describe('Continue fullPage capture using the previous nextCursor'),
  format: z.enum(['png', 'jpeg']).optional().describe('Image format (default: png)'),
  quality: z.number().int().min(0).max(100).optional().describe('JPEG quality 0-100 (only for jpeg format)')
})
export type ScreenshotOptions = z.infer<typeof screenshotOptionsSchema>
type Rect = Pick<Protocol.Page.Viewport, 'x' | 'y' | 'width' | 'height'>
export interface BrowserScreenshot {
  documentId: string
  region: Rect
  images: Array<{ data: string; mimeType: string; region: Rect; scale: number; index: number }>
  totalTiles: number
  nextCursor?: string
}
const cursorSchema = z.object({
  documentId: z.string(),
  region: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }),
  index: z.number().int().nonnegative()
})

export async function captureScreenshot(
  session: GuestSession,
  input: ScreenshotOptions,
  commands: CommandOptions
): Promise<BrowserScreenshot> {
  commands.signal?.throwIfAborted()
  if (input.ref && input.fullPage) throw new Error('Choose ref or fullPage, not both.')
  if (input.cursor && !input.fullPage) throw new Error('A screenshot cursor requires fullPage: true.')
  const { frameTree } = await session.send('Page.getFrameTree', undefined, commands)
  const documentId = frameTree.frame.loaderId
  const check = () => {
    commands.signal?.throwIfAborted()
    if (session.documentId !== documentId) throw new BrowserSessionError('stale_ref')
  }
  check()
  const metrics = await session.send('Page.getLayoutMetrics', undefined, commands)
  check()
  const viewport = metrics.cssVisualViewport
  const page = metrics.cssContentSize
  let region: Rect = input.fullPage
    ? { ...page }
    : { x: viewport.pageX, y: viewport.pageY, width: viewport.clientWidth, height: viewport.clientHeight }
  if (input.ref) {
    region = await withElement(
      session,
      input.ref,
      async (_objectId, backendNodeId, checkRef) => {
        const { model } = await session.send('DOM.getBoxModel', { backendNodeId }, commands)
        checkRef()
        const xs = model.border.filter((_, i) => i % 2 === 0)
        const ys = model.border.filter((_, i) => i % 2 === 1)
        const x = Math.max(page.x, Math.floor(Math.min(...xs) + metrics.cssLayoutViewport.pageX - 12))
        const y = Math.max(page.y, Math.floor(Math.min(...ys) + metrics.cssLayoutViewport.pageY - 12))
        return {
          x,
          y,
          width: Math.min(page.x + page.width, Math.ceil(Math.max(...xs) + metrics.cssLayoutViewport.pageX + 12)) - x,
          height: Math.min(page.y + page.height, Math.ceil(Math.max(...ys) + metrics.cssLayoutViewport.pageY + 12)) - y
        }
      },
      commands
    )
  }
  if (
    ![region.x, region.y, region.width, region.height].every(Number.isFinite) ||
    region.width <= 0 ||
    region.height <= 0
  )
    throw new BrowserSessionError('not_found')
  check()
  let start = 0
  if (input.cursor) {
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')))
    if (
      cursor.documentId !== documentId ||
      Object.keys(region).some((key) => region[key as keyof Rect] !== cursor.region[key as keyof Rect])
    )
      throw new Error('The page changed. Start a new screenshot without cursor.')
    start = cursor.index
  }
  const tileWidth = input.fullPage ? Math.min(MAX_SIDE, region.width) : region.width
  const tileHeight = input.fullPage
    ? Math.min(MAX_SIDE, Math.floor(MAX_PIXELS / tileWidth), region.height)
    : region.height
  const columns = Math.ceil(region.width / tileWidth)
  const totalTiles = columns * Math.ceil(region.height / tileHeight)
  if (start >= totalTiles) throw new Error('Screenshot cursor is outside the page.')
  // An isolated world reads native DPR without trusting overrides made by page scripts.
  const world = await session.send(
    'Page.createIsolatedWorld',
    { frameId: session.mainFrameId, worldName: 'cherry-browser-screenshot' },
    commands
  )
  const { result } = await session.send(
    'Runtime.evaluate',
    { expression: 'window.devicePixelRatio', contextId: world.executionContextId, returnByValue: true },
    commands
  )
  const dpr: number = result.value
  const zoom = session.guest.getZoomFactor()
  if (!Number.isFinite(dpr) || dpr <= 0) throw new Error('Screenshot pixel ratio is unavailable.')
  const images: BrowserScreenshot['images'] = []
  let bytes = 0
  let index = start
  for (; index < Math.min(totalTiles, start + MAX_IMAGES); index++) {
    check()
    const x = region.x + (index % columns) * tileWidth
    const y = region.y + Math.floor(index / columns) * tileHeight
    const tile = {
      x,
      y,
      width: Math.min(tileWidth, region.x + region.width - x),
      height: Math.min(tileHeight, region.y + region.height - y)
    }
    const scale = Math.min(
      1,
      MAX_SIDE / tile.width,
      MAX_SIDE / tile.height,
      Math.sqrt(MAX_PIXELS / (tile.width * tile.height))
    )
    const { data } = await session.send(
      'Page.captureScreenshot',
      {
        format: input.format ?? 'png',
        ...(input.format === 'jpeg' && input.quality !== undefined ? { quality: input.quality } : {}),
        captureBeyondViewport: true,
        clip: { x: x * zoom, y: y * zoom, width: tile.width * zoom, height: tile.height * zoom, scale: scale / dpr }
      },
      commands
    )
    check()
    if (bytes + data.length > MAX_BASE64_BYTES) {
      if (images.length === 0) throw new Error('Screenshot exceeds the image budget. Use a smaller target ref.')
      break
    }
    bytes += data.length
    images.push({ data, mimeType: input.format === 'jpeg' ? 'image/jpeg' : 'image/png', region: tile, scale, index })
  }
  return {
    documentId,
    region,
    images,
    totalTiles,
    ...(index < totalTiles
      ? { nextCursor: Buffer.from(JSON.stringify({ documentId, region, index })).toString('base64url') }
      : {})
  }
}
