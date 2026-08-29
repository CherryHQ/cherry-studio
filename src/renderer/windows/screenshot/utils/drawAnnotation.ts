/**
 * Canvas renderers for each annotation type.
 *
 * Every function receives a context already transformed to logical coordinates
 * (the scale factor is applied by the caller) and translated so that
 * image-absolute annotation coordinates land in canvas-local space.
 */

import type { Annotation, ArrowAnnotation, BrushAnnotation, RectAnnotation, TextAnnotation } from '../types'

/** Line-height multiplier. MUST stay equal to the textarea's CSS `lineHeight`, or multi-line text drifts line by line between editor and render. */
export const TEXT_LINE_HEIGHT = 1.2

/** Resolved font stack, cached: `getComputedStyle` per annotation per frame forces synchronous layout. */
let fontFamilyCache: string | null = null

/**
 * The font the annotation text is drawn in.
 *
 * Deliberately read off the live document rather than named as a token: the
 * floating textarea uses this exact string too, and the canvas render only lines
 * up with what the user typed if both sides resolve to the same font.
 */
export function getOverlayFontFamily(): string {
  if (!fontFamilyCache) {
    fontFamilyCache = getComputedStyle(document.body).fontFamily.trim() || 'sans-serif'
  }
  return fontFamilyCache
}

/** Cached per font size; the family and line height never vary within a window. */
const baselineCache = new Map<number, number>()

/**
 * Distance from a text block's top edge to its alphabetic baseline, measured by
 * asking the browser's own layout engine.
 *
 * Any hand-rolled substitute (`fontSize * 0.8`, `TextMetrics.actualBoundingBoxAscent`)
 * misses the CSS half-leading model, and the text visibly jumps the moment the
 * textarea is replaced by the canvas render.
 */
function getCssBaseline(fontSize: number): number {
  const cached = baselineCache.get(fontSize)
  if (cached !== undefined) return cached

  const el = document.createElement('div')
  el.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;font-size:${fontSize}px;font-family:${getOverlayFontFamily()};line-height:${TEXT_LINE_HEIGHT};padding:0;margin:0;border:none;white-space:pre`
  // An empty inline-block's baseline is its bottom margin edge (CSS 2 §10.8.1), and
  // `vertical-align: baseline` aligns that edge with the parent's alphabetic baseline.
  el.innerHTML =
    'Ag<span style="display:inline-block;width:1px;height:1px;vertical-align:baseline;overflow:hidden"></span>'
  document.body.appendChild(el)

  const elRect = el.getBoundingClientRect()
  const probe = el.querySelector('span')
  const baseline = probe ? probe.getBoundingClientRect().bottom - elRect.top : fontSize

  document.body.removeChild(el)
  baselineCache.set(fontSize, baseline)
  return baseline
}

/** Draw one annotation. Mosaic is absent on purpose — it needs image data and is rendered by `utils/mosaic.ts`. */
export function drawAnnotation(ctx: CanvasRenderingContext2D, annotation: Annotation): void {
  switch (annotation.type) {
    case 'rect':
      drawRect(ctx, annotation)
      break
    case 'arrow':
      drawArrow(ctx, annotation)
      break
    case 'brush':
      drawBrush(ctx, annotation)
      break
    case 'text':
      drawText(ctx, annotation)
      break
    case 'mosaic':
      break
  }
}

function drawRect(ctx: CanvasRenderingContext2D, a: RectAnnotation): void {
  ctx.strokeStyle = a.color
  ctx.lineWidth = a.strokeWidth
  ctx.lineJoin = 'miter'
  // Centred stroke is intentional here, unlike the selection border.
  ctx.strokeRect(a.rect.x, a.rect.y, a.rect.width, a.rect.height)
}

/**
 * Arrow proportions per stroke width, all in logical px:
 * `[shaft width at the tail, shaft width at the head junction, head wing span, head length]`.
 */
const ARROW_DIMS: Record<number, [number, number, number, number]> = {
  2: [3, 9, 20, 26],
  4: [6, 12, 30, 39],
  6: [9, 18, 40, 52]
}

/**
 * Draw an arrow as a single filled polygon: a shaft that widens toward the head,
 * fused with a pointed head whose wings curve in via `quadraticCurveTo`. The tip stays sharp.
 */
function drawArrow(ctx: CanvasRenderingContext2D, a: ArrowAnnotation): void {
  const { start, end, color, strokeWidth: sw } = a
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.sqrt(dx * dx + dy * dy)

  // Zero length would make every unit vector NaN and poison the whole path.
  if (len < 1) return

  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux

  // The table only has 2/4/6; a width restored from an older preference must not destructure undefined.
  const [startWidth, endWidth, headWidth, headLen] = ARROW_DIMS[sw] ?? ARROW_DIMS[4]
  const startHalfW = startWidth / 2
  const endHalfW = endWidth / 2
  const headHalfW = headWidth / 2
  const curveDep = headLen * 0.35

  ctx.fillStyle = color
  ctx.beginPath()

  if (len >= headLen) {
    const jx = start.x + ux * (len - headLen)
    const jy = start.y + uy * (len - headLen)

    const wlx = jx + nx * headHalfW
    const wly = jy + ny * headHalfW
    const wrx = jx - nx * headHalfW
    const wry = jy - ny * headHalfW

    ctx.moveTo(start.x + nx * startHalfW, start.y + ny * startHalfW)
    ctx.lineTo(jx + nx * endHalfW, jy + ny * endHalfW)
    ctx.lineTo(wlx, wly)
    ctx.quadraticCurveTo(wlx + ux * curveDep, wly + uy * curveDep, end.x, end.y)
    ctx.quadraticCurveTo(wrx + ux * curveDep, wry + uy * curveDep, wrx, wry)
    ctx.lineTo(jx - nx * endHalfW, jy - ny * endHalfW)
    ctx.lineTo(start.x - nx * startHalfW, start.y - ny * startHalfW)
    ctx.closePath()
  } else {
    // Shorter than its own head: shrink the head and drop the shaft, or the arrow renders inside-out.
    const hw = headHalfW * (len / headLen)

    ctx.moveTo(start.x + nx * hw, start.y + ny * hw)
    ctx.lineTo(end.x, end.y)
    ctx.lineTo(start.x - nx * hw, start.y - ny * hw)
    ctx.closePath()
  }

  ctx.fill()
}

function drawBrush(ctx: CanvasRenderingContext2D, a: BrushAnnotation): void {
  if (a.points.length < 2) return
  ctx.strokeStyle = a.color
  ctx.lineWidth = a.strokeWidth
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  ctx.beginPath()
  ctx.moveTo(a.points[0].x, a.points[0].y)
  for (let i = 1; i < a.points.length; i++) {
    ctx.lineTo(a.points[i].x, a.points[i].y)
  }
  ctx.stroke()
}

/**
 * Wrap text the way the textarea did.
 *
 * Segments by grapheme cluster so emoji sequences and CJK survive, matching the
 * `word-break: break-all` the editor used; splitting by code unit would produce
 * mojibake and wrap at different points than the user saw while typing.
 */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      lines.push('')
      continue
    }
    let current = ''
    for (const { segment } of segmenter.segment(paragraph)) {
      const test = current + segment
      // `current &&` keeps a single oversized grapheme from being dropped entirely.
      if (current && ctx.measureText(test).width > maxWidth) {
        lines.push(current)
        current = segment
      } else {
        current = test
      }
    }
    lines.push(current)
  }
  return lines
}

function drawText(ctx: CanvasRenderingContext2D, a: TextAnnotation): void {
  ctx.fillStyle = a.color
  ctx.font = `${a.fontSize}px ${getOverlayFontFamily()}`
  ctx.textBaseline = 'alphabetic'

  const baselineY = a.position.y + getCssBaseline(a.fontSize)
  const lineHeight = a.fontSize * TEXT_LINE_HEIGHT

  const lines = a.maxWidth != null ? wrapLines(ctx, a.content, a.maxWidth) : a.content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], a.position.x, baselineY + i * lineHeight)
  }
}
