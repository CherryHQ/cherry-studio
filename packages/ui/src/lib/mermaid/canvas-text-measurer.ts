import type { HostTextMeasurer, HostTextMeasureRequest, HostTextMeasureResult } from '@mermanjs/web-render'

// Ideographs, kana, hangul and full-width forms break between any two characters; other text breaks at spaces.
const BREAK_TOKENS = /[⺀-鿿가-힯豈-﫿＀-￯]|\s+|[^\s⺀-鿿가-힯豈-﫿＀-￯]+/gu

/**
 * Measures Merman labels with an OffscreenCanvas, so rendering works where the DOM probes of
 * `createBrowserTextMeasurementSession` are unavailable, such as a Web Worker. Widths are glyph
 * advances; SVG box heights are the font's ascent plus descent; HTML-like wrapping breaks greedily.
 */
export function createCanvasTextMeasurer(): HostTextMeasurer {
  const context = new OffscreenCanvas(1, 1).getContext('2d')
  if (!context) return () => undefined

  const use = (request: HostTextMeasureRequest) => {
    const size = Number.isFinite(request.font_size) ? request.font_size : 16
    const family = request.font_family || 'sans-serif'
    context.font = `${request.font_style || 'normal'} ${request.font_weight ?? 'normal'} ${size}px ${family}`
    context.letterSpacing = `${request.letter_spacing || 0}px`
    context.wordSpacing = `${request.word_spacing || 0}px`
  }
  const width = (text: string) => Math.max(0, context.measureText(text).width)
  const fontBox = () => {
    const metrics = context.measureText('Mg')
    return {
      ascent: metrics.fontBoundingBoxAscent,
      height: metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent
    }
  }

  const wrapLines = (text: string, maxWidth: number | null): string[] =>
    text.split('\n').flatMap((paragraph) => {
      if (maxWidth === null) return [paragraph]
      const lines: string[] = []
      let line = ''
      for (const token of paragraph.match(BREAK_TOKENS) ?? []) {
        const candidate = line + token
        if (line && !/^\s+$/.test(token) && width(candidate.trimEnd()) > maxWidth) {
          lines.push(line.trimEnd())
          line = token.trimStart()
        } else {
          line = candidate
        }
      }
      lines.push(line.trimEnd())
      return lines
    })

  const wrapped = (request: HostTextMeasureRequest) => {
    const maxWidth = request.has_max_width && request.max_width ? request.max_width : null
    const natural = Math.max(...request.text.split('\n').map(width))
    const lines = request.white_space === 'nowrap' ? request.text.split('\n') : wrapLines(request.text, maxWidth)
    const wraps = maxWidth !== null && natural > maxWidth
    return {
      width: wraps ? maxWidth : natural,
      height: lines.length * request.line_height,
      lineCount: lines.length,
      rawWidth: natural
    }
  }

  return (request): HostTextMeasureResult | undefined => {
    use(request)
    if (!request.text) {
      if (request.operation === 'bbox-x' || request.operation === 'bbox-x-with-ascii-overhang') {
        return { kind: 'horizontal-extents', bbox_left: 0, bbox_right: 0 }
      }
      if (request.operation === 'title-bbox-x') return { kind: 'horizontal-extents', bbox_left: 0, bbox_right: 0 }
      if (request.operation === 'measure' || request.operation === 'wrapped') {
        return { kind: 'metrics', width: 0, height: 0, line_count: 1 }
      }
      return { kind: 'length', length: 0 }
    }
    switch (request.operation) {
      case 'measure':
      case 'mermaid-calculate-text-dimensions':
        return { kind: 'metrics', width: width(request.text), height: fontBox().height, line_count: 1 }
      case 'wrapped': {
        if (request.wrap_mode !== 'html-like') return undefined
        const { width: w, height, lineCount } = wrapped(request)
        return { kind: 'metrics', width: w, height, line_count: lineCount }
      }
      case 'wrapped-with-raw-width': {
        if (request.wrap_mode !== 'html-like') return undefined
        const { width: w, height, lineCount, rawWidth } = wrapped(request)
        return { kind: 'wrapped-with-raw-width', width: w, height, line_count: lineCount, raw_width: rawWidth }
      }
      case 'computed-length':
      case 'canvas-measure-text-width':
      case 'raw-bbox-width':
      case 'tspan-bbox-width':
      case 'simple-bbox-width':
      case 'wrap-probe-bbox-width':
      case 'bounding-client-rect-width':
        return { kind: 'length', length: width(request.text) }
      case 'raw-bbox-height':
      case 'tspan-bbox-height':
      case 'simple-bbox-height':
        return { kind: 'length', length: fontBox().height }
      case 'raw-bbox-y-offset':
        return { kind: 'length', length: -fontBox().ascent }
      default:
        // Baseline-relative offsets and bbox extents fall back to Merman's deterministic measurement.
        return undefined
    }
  }
}
