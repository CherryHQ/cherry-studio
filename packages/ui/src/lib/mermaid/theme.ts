import { collectFontFaces, type FontFaceSource } from './fonts'

/** Merman's host theme: semantic roles and categorical palette, all opaque hex. Serializable for a worker. */
export interface MermaidTheme {
  appearance: 'light' | 'dark'
  fontFamily: string
  fontSize: string
  /** The page's web fonts in `fontFamily`, which a worker must load to measure labels like the page draws them. */
  fontFaces: FontFaceSource[]
  roles: Record<string, string>
  seriesPalette: string[]
}

// Merman role → design-system variable. The canvas roles come from the host's actual background instead.
const ROLE_TOKENS: Record<string, string> = {
  surface: '--muted',
  'surface-alt': '--secondary',
  text: '--foreground',
  'subtle-text': '--muted-foreground',
  border: '--border-strong',
  line: '--muted-foreground',
  'cluster-background': '--background-subtle',
  'cluster-border': '--border',
  'note-background': '--warning-subtle',
  'note-border': '--warning-border',
  success: '--success'
}
const SERIES_TOKENS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5']

let probe: CanvasRenderingContext2D | null = null
// Font rules are static once the app's styles load, so each font list is scanned once.
const fontFacesByFamily = new Map<string, FontFaceSource[]>()

/** Paints `layers` bottom-up on one pixel and returns it as RGBA, so oklch and translucent paints resolve. */
function paint(layers: string[]): Uint8ClampedArray {
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!probe) return new Uint8ClampedArray([255, 255, 255, 255])
  probe.clearRect(0, 0, 1, 1)
  for (const layer of layers) {
    probe.fillStyle = layer
    probe.fillRect(0, 0, 1, 1)
  }
  return probe.getImageData(0, 0, 1, 1).data
}

function paintHex(layers: string[]): string {
  const [r, g, b] = paint(layers)
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/** The colour the page actually shows behind `element`: every translucent ancestor layer over the first opaque one. */
function backgroundBehind(element: Element): string {
  const layers: string[] = []
  for (let node: Element | null = element; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor
    const alpha = paint([color])[3] / 255
    if (alpha === 0) continue
    layers.push(color)
    if (alpha === 1) break
  }
  const page = getComputedStyle(document.documentElement).getPropertyValue('--background').trim() || '#ffffff'
  return paintHex(['#ffffff', page, ...layers.reverse()])
}

/** Resolves the diagram theme from the design tokens and background in effect at `element`. */
export function resolveMermaidTheme(element: Element): MermaidTheme {
  const style = getComputedStyle(element)
  // Diagrams use the shared body typography, not a surrounding code block's monospace.
  const body = getComputedStyle(element.ownerDocument.body)
  const canvas = backgroundBehind(element)
  const token = (name: string) => paintHex([canvas, style.getPropertyValue(name).trim() || 'transparent'])
  const roles = Object.fromEntries(Object.entries(ROLE_TOKENS).map(([role, name]) => [role, token(name)]))
  const [r, g, b] = [1, 3, 5].map((index) => Number.parseInt(canvas.slice(index, index + 2), 16))
  return {
    appearance: 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? 'dark' : 'light',
    fontFamily: body.fontFamily,
    fontSize: body.fontSize,
    fontFaces: fontFacesByFamily.get(body.fontFamily) ?? cacheFontFaces(body.fontFamily),
    roles: { ...roles, canvas, 'edge-label-background': canvas },
    seriesPalette: SERIES_TOKENS.map(token)
  }
}

function cacheFontFaces(fontFamily: string): FontFaceSource[] {
  const faces = collectFontFaces(fontFamily)
  fontFacesByFamily.set(fontFamily, faces)
  return faces
}
