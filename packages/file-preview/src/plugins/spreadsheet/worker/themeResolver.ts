import { XMLParser } from 'fast-xml-parser'

/**
 * theme1.xml theme color parsing plus tint/indexed color resolution.
 * Note that Excel theme index order swaps dk1/lt1 compared with XML clrScheme order.
 */

export interface ResolvedTheme {
  /** Mapped index order: [lt1, dk1, lt2, dk2, accent1..6, hlink, folHlink]. */
  colors: string[]
}

/** ExcelJS color reference shape: argb, theme+tint, or indexed. */
export interface ExcelColorRef {
  argb?: string
  theme?: number
  tint?: number
  indexed?: number
}

/** Office default theme color table in clrScheme order: dk1, lt1, dk2, lt2, accent1..6, hlink, folHlink. */
const DEFAULT_OFFICE_THEME_CLR_SCHEME = {
  dk1: '000000',
  lt1: 'FFFFFF',
  dk2: '44546A',
  lt2: 'E7E6E6',
  accent1: '4472C4',
  accent2: 'ED7D31',
  accent3: 'A5A5A5',
  accent4: 'FFC000',
  accent5: '5B9BD5',
  accent6: '70AD47',
  hlink: '0563C1',
  folHlink: '954F72'
}

/** Built-in 64-color palette from ECMA-376 section 18.8.27. 0-based index = indexed color value. */
const INDEXED_PALETTE: string[] = [
  '000000',
  'FFFFFF',
  'FF0000',
  '00FF00',
  '0000FF',
  'FFFF00',
  'FF00FF',
  '00FFFF',
  '000000',
  'FFFFFF',
  'FF0000',
  '00FF00',
  '0000FF',
  'FFFF00',
  'FF00FF',
  '00FFFF',
  '800000',
  '008000',
  '000080',
  '808000',
  '800080',
  '008080',
  'C0C0C0',
  '808080',
  '9999FF',
  '993366',
  'FFFFCC',
  'CCFFFF',
  '660066',
  'FF8080',
  '0066CC',
  'CCCCFF',
  '000080',
  'FF00FF',
  'FFFF00',
  '00FFFF',
  '800080',
  '800000',
  '008080',
  '0000FF',
  '00CCFF',
  'CCFFFF',
  'CCFFCC',
  'FFFF99',
  '99CCFF',
  'FF99CC',
  'CC99FF',
  'FFCC99',
  '3366FF',
  '33CCCC',
  '99CC00',
  'FFCC00',
  'FF9900',
  'FF6600',
  '666699',
  '969696',
  '003366',
  '339966',
  '003300',
  '333300',
  '993300',
  '993366',
  '333399',
  '333333'
]

/** RGB (0-255) -> HSL (h: 0-360, s/l: 0-1). */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) {
    return [0, 0, l]
  }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  switch (max) {
    case rn:
      h = (gn - bn) / d + (gn < bn ? 6 : 0)
      break
    case gn:
      h = (bn - rn) / d + 2
      break
    default:
      h = (rn - gn) / d + 4
  }
  h *= 60
  return [h, s, l]
}

/** HSL -> RGB (0-255). */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hn = h / 360
  const r = hue2rgb(p, q, hn + 1 / 3)
  const g = hue2rgb(p, q, hn)
  const b = hue2rgb(p, q, hn - 1 / 3)
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

const clampByte = (n: number): number => Math.min(255, Math.max(0, n))

/** Apply tint to 6-digit RGB hex with no alpha. */
function applyTint(rgbHex: string, tint: number): string {
  const r = parseInt(rgbHex.slice(0, 2), 16)
  const g = parseInt(rgbHex.slice(2, 4), 16)
  const b = parseInt(rgbHex.slice(4, 6), 16)
  const [h, s, l] = rgbToHsl(r, g, b)
  const newL = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint
  const [nr, ng, nb] = hslToRgb(h, s, Math.min(1, Math.max(0, newL)))
  return [nr, ng, nb].map((v) => clampByte(v).toString(16).padStart(2, '0')).join('')
}

/** 6-digit RGB hex -> CSS color. */
const rgbHexToCss = (rgbHex: string): string => `#${rgbHex.toLowerCase()}`

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
const RGB_HEX_PATTERN = /^[0-9a-f]{6}$/i

interface ClrNode {
  'a:srgbClr'?: { '@_val'?: string }
  'a:sysClr'?: { '@_val'?: string; '@_lastClr'?: string }
}

function readClr(node: ClrNode | undefined): string | undefined {
  if (!node) return undefined
  const value = node['a:srgbClr']?.['@_val'] ?? node['a:sysClr']?.['@_lastClr']
  return value && RGB_HEX_PATTERN.test(value) ? value : undefined
}

/** themeXml null -> built-in Office default theme color table. */
export function parseTheme(themeXml: string | null): ResolvedTheme {
  let scheme = DEFAULT_OFFICE_THEME_CLR_SCHEME
  if (themeXml) {
    try {
      const parsed = xmlParser.parse(themeXml)
      const clrScheme = parsed?.['a:theme']?.['a:themeElements']?.['a:clrScheme']
      if (clrScheme) {
        scheme = {
          dk1: readClr(clrScheme['a:dk1']) ?? DEFAULT_OFFICE_THEME_CLR_SCHEME.dk1,
          lt1: readClr(clrScheme['a:lt1']) ?? DEFAULT_OFFICE_THEME_CLR_SCHEME.lt1,
          dk2: readClr(clrScheme['a:dk2']) ?? DEFAULT_OFFICE_THEME_CLR_SCHEME.dk2,
          lt2: readClr(clrScheme['a:lt2']) ?? DEFAULT_OFFICE_THEME_CLR_SCHEME.lt2,
          accent1: readClr(clrScheme['a:accent1']) ?? DEFAULT_OFFICE_THEME_CLR_SCHEME.accent1,
          accent2: readClr(clrScheme['a:accent2']) ?? DEFAULT_OFFICE_THEME_CLR_SCHEME.accent2,
          accent3: readClr(clrScheme['a:accent3']) ?? DEFAULT_OFFICE_THEME_CLR_SCHEME.accent3,
          accent4: readClr(clrScheme['a:accent4']) ?? DEFAULT_OFFICE_THEME_CLR_SCHEME.accent4,
          accent5: readClr(clrScheme['a:accent5']) ?? DEFAULT_OFFICE_THEME_CLR_SCHEME.accent5,
          accent6: readClr(clrScheme['a:accent6']) ?? DEFAULT_OFFICE_THEME_CLR_SCHEME.accent6,
          hlink: readClr(clrScheme['a:hlink']) ?? DEFAULT_OFFICE_THEME_CLR_SCHEME.hlink,
          folHlink: readClr(clrScheme['a:folHlink']) ?? DEFAULT_OFFICE_THEME_CLR_SCHEME.folHlink
        }
      }
    } catch {
      scheme = DEFAULT_OFFICE_THEME_CLR_SCHEME
    }
  }

  // Theme index order: [lt1, dk1, lt2, dk2, accent1..6, hlink, folHlink], swapping dk1/lt1 from XML order.
  const colors = [
    scheme.lt1,
    scheme.dk1,
    scheme.lt2,
    scheme.dk2,
    scheme.accent1,
    scheme.accent2,
    scheme.accent3,
    scheme.accent4,
    scheme.accent5,
    scheme.accent6,
    scheme.hlink,
    scheme.folHlink
  ].map(rgbHexToCss)

  return { colors }
}

/**
 * ARGB -> CSS color. The alpha byte must be ignored: Excel cell formats do not support transparency.
 * That byte is only historical padding. Generators such as openpyxl normalize 6-digit colors to '00RRGGBB' (alpha=00),
 * which would render text/fill as fully transparent if interpreted literally.
 */
function argbToCss(argb: string): string {
  return rgbHexToCss(argb.length === 8 ? argb.slice(2) : argb)
}

/** Priority: argb > theme+tint > indexed > undefined. */
export function resolveColor(color: ExcelColorRef | undefined, theme: ResolvedTheme): string | undefined {
  if (!color) return undefined
  if (color.argb) {
    return argbToCss(color.argb)
  }
  if (color.theme !== undefined) {
    const base = theme.colors[color.theme]
    if (base === undefined) return undefined
    if (!color.tint) return base
    return rgbHexToCss(applyTint(base.slice(1), color.tint))
  }
  if (color.indexed !== undefined) {
    const rgbHex = INDEXED_PALETTE[color.indexed]
    if (rgbHex === undefined) return undefined
    return rgbHexToCss(rgbHex)
  }
  return undefined
}
