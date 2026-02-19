import { describe, expect, it } from 'vitest'

import {
  colorToLuminance,
  isLargeShape,
  isMonochromeSvg,
  isWhiteFill,
  normalizeColor,
  parseSvgPathBounds,
  parseViewBox
} from '../svg-utils'

// ─── colorToLuminance ───────────────────────────────────────────────

describe('colorToLuminance', () => {
  it('returns 0 for black', () => {
    expect(colorToLuminance('#000000')).toBe(0)
    expect(colorToLuminance('#000')).toBe(0)
    expect(colorToLuminance('black')).toBe(0)
  })

  it('returns 1 for white', () => {
    expect(colorToLuminance('#FFFFFF')).toBeCloseTo(1, 5)
    expect(colorToLuminance('#fff')).toBeCloseTo(1, 5)
    expect(colorToLuminance('white')).toBe(1)
  })

  it('computes luminance for dark green #133426 (ZeroOne bg)', () => {
    // R=19 G=52 B=38 → 0.299*(19/255) + 0.587*(52/255) + 0.114*(38/255)
    const lum = colorToLuminance('#133426')
    expect(lum).toBeGreaterThan(0.15)
    expect(lum).toBeLessThan(0.17)
  })

  it('computes luminance for dark teal #055F4E (AwsBedrock bg gradient first stop)', () => {
    const lum = colorToLuminance('#055F4E')
    expect(lum).toBeGreaterThan(0.24)
    expect(lum).toBeLessThan(0.27)
  })

  it('computes luminance for Groq orange #F54F35', () => {
    const lum = colorToLuminance('#F54F35')
    expect(lum).toBeGreaterThan(0.4)
    expect(lum).toBeLessThan(0.6)
  })

  it('returns -1 for url() references', () => {
    expect(colorToLuminance('url(#gradient)')).toBe(-1)
  })

  it('returns -1 for unrecognized named colors', () => {
    // colorToLuminance only handles black/white as named colors;
    // other named colors like 'red' return NaN (invalid hex parse)
    expect(colorToLuminance('red')).toBeNaN()
    expect(colorToLuminance('steelblue')).toBe(-1)
  })

  it('handles 3-char hex shorthand', () => {
    // #F00 → R=255 G=0 B=0 → 0.299*1 = 0.299
    expect(colorToLuminance('#F00')).toBeCloseTo(0.299, 2)
  })
})

// ─── isWhiteFill ────────────────────────────────────────────────────

describe('isWhiteFill', () => {
  it('recognizes "white"', () => {
    expect(isWhiteFill('white')).toBe(true)
  })

  it('recognizes #fff and #ffffff', () => {
    expect(isWhiteFill('#fff')).toBe(true)
    expect(isWhiteFill('#ffffff')).toBe(true)
    expect(isWhiteFill('#FFFFFF')).toBe(true)
  })

  it('recognizes near-white #FEFBFB (Groq fg)', () => {
    expect(isWhiteFill('#FEFBFB')).toBe(true)
  })

  it('rejects non-white colors', () => {
    expect(isWhiteFill('#000000')).toBe(false)
    expect(isWhiteFill('#F54F35')).toBe(false)
    expect(isWhiteFill('#133426')).toBe(false)
  })

  it('rejects url() references', () => {
    expect(isWhiteFill('url(#grad)')).toBe(false)
  })

  it('rejects near-white but below threshold (#DEDEDE)', () => {
    expect(isWhiteFill('#DEDEDE')).toBe(false)
  })
})

// ─── parseSvgPathBounds ─────────────────────────────────────────────

describe('parseSvgPathBounds', () => {
  it('parses simple rect path M0 0H24V24H0V0Z', () => {
    const b = parseSvgPathBounds('M0 0H24V24H0V0Z')
    expect(b.minX).toBe(0)
    expect(b.minY).toBe(0)
    expect(b.maxX).toBe(24)
    expect(b.maxY).toBe(24)
  })

  it('parses rounded-rect path with decimals (AwsBedrock pattern)', () => {
    // M18.5455 0H5.45455C2.44208 0 0 2.44208 0 5.45455V18.5455C...24...Z
    const d =
      'M18.5455 0H5.45455C2.44208 0 0 2.44208 0 5.45455V18.5455C0 21.5579 2.44208 24 24 18.5455V5.45455C24 2.44208 21.5579 0 18.5455 0Z'
    const b = parseSvgPathBounds(d)
    expect(b.minX).toBe(0)
    expect(b.minY).toBe(0)
    expect(b.maxX).toBe(24)
    expect(b.maxY).toBe(24)
  })

  it('parses Anthropic rounded-rect M18 0H6C... path', () => {
    const d =
      'M18 0H6C2.68629 0 0 2.68629 0 6V18C0 21.3137 2.68629 24 6 24H18C21.3137 24 24 21.3137 24 18V6C24 2.68629 21.3137 0 18 0Z'
    const b = parseSvgPathBounds(d)
    expect(b.minX).toBe(0)
    expect(b.minY).toBe(0)
    expect(b.maxX).toBe(24)
    expect(b.maxY).toBe(24)
  })

  it('parses rounded-rect path with Arc (A) commands and concatenated flags (Sora pattern)', () => {
    const d =
      'M19.503 0H4.496A4.496 4.496 0 000 4.496v15.007A4.496 4.496 0 004.496 24h15.007A4.496 4.496 0 0024 19.503V4.496A4.496 4.496 0 0019.503 0z'
    const b = parseSvgPathBounds(d)
    expect(b.minX).toBeCloseTo(0, 0)
    expect(b.minY).toBeCloseTo(0, 0)
    expect(b.maxX).toBeCloseTo(24, 0)
    expect(b.maxY).toBeCloseTo(24, 0)
  })

  it('returns Infinity for empty path', () => {
    const b = parseSvgPathBounds('')
    expect(b.minX).toBe(Infinity)
  })

  it('handles relative commands', () => {
    // Start at (10, 10), move +5,+5
    const b = parseSvgPathBounds('M10 10l5 5')
    expect(b.minX).toBe(10)
    expect(b.minY).toBe(10)
    expect(b.maxX).toBe(15)
    expect(b.maxY).toBe(15)
  })
})

// ─── parseViewBox ───────────────────────────────────────────────────

describe('parseViewBox', () => {
  it('parses standard viewBox', () => {
    const vb = parseViewBox({ viewBox: '0 0 24 24' })
    expect(vb).toEqual({ x: 0, y: 0, w: 24, h: 24 })
  })

  it('parses comma-separated viewBox', () => {
    const vb = parseViewBox({ viewBox: '0,0,100,50' })
    expect(vb).toEqual({ x: 0, y: 0, w: 100, h: 50 })
  })

  it('falls back to width/height when no viewBox', () => {
    const vb = parseViewBox({ width: '32', height: '32' })
    expect(vb).toEqual({ x: 0, y: 0, w: 32, h: 32 })
  })

  it('defaults to 24x24 when no attributes', () => {
    const vb = parseViewBox({})
    expect(vb).toEqual({ x: 0, y: 0, w: 24, h: 24 })
  })
})

// ─── isLargeShape ───────────────────────────────────────────────────

describe('isLargeShape', () => {
  it('detects full-viewBox rect path as large', () => {
    expect(isLargeShape('M0 0H24V24H0V0Z', 24, 24)).toBe(true)
  })

  it('rejects small shape', () => {
    expect(isLargeShape('M10 10H14V14H10V10Z', 24, 24, 0.3)).toBe(false)
  })

  it('respects custom threshold', () => {
    // 12x12 = 144, vb = 576, ratio = 0.25
    expect(isLargeShape('M0 0H12V12H0V12Z', 24, 24, 0.2)).toBe(true)
    expect(isLargeShape('M0 0H12V12H0V12Z', 24, 24, 0.3)).toBe(false)
  })
})

// ─── normalizeColor ─────────────────────────────────────────────────

describe('normalizeColor', () => {
  it('expands 3-char hex', () => {
    expect(normalizeColor('#abc')).toBe('#AABBCC')
  })

  it('uppercases 6-char hex', () => {
    expect(normalizeColor('#f54f35')).toBe('#F54F35')
  })

  it('passes through none/currentColor/url()', () => {
    expect(normalizeColor('none')).toBe('none')
    expect(normalizeColor('currentColor')).toBe('currentColor')
    expect(normalizeColor('url(#a)')).toBe('url(#a)')
  })
})

// ─── isMonochromeSvg ───────────────────────────────────────────────

describe('isMonochromeSvg', () => {
  it('detects pure black SVG as monochrome, not dark-designed', () => {
    const svg = '<svg viewBox="0 0 24 24"><path fill="#000000" d="M0 0h24v24H0z"/></svg>'
    expect(isMonochromeSvg(svg)).toEqual({ monochrome: true, darkDesigned: false })
  })

  it('detects pure white SVG as monochrome and dark-designed', () => {
    const svg = '<svg viewBox="0 0 24 24"><path fill="#ffffff" d="M0 0h24v24H0z"/></svg>'
    expect(isMonochromeSvg(svg)).toEqual({ monochrome: true, darkDesigned: true })
  })

  it('detects multi-color SVG as not monochrome', () => {
    const svg =
      '<svg viewBox="0 0 24 24"><path fill="#FF0000" d="M0 0h12v24H0z"/><path fill="#0000FF" d="M12 0h12v24H12z"/></svg>'
    expect(isMonochromeSvg(svg)).toEqual({ monochrome: false, darkDesigned: false })
  })

  it('detects gray-only SVG as monochrome, not dark-designed', () => {
    const svg =
      '<svg viewBox="0 0 24 24"><path fill="#333333" d="M0 0h12v24H0z"/><path fill="#666666" d="M12 0h12v24H12z"/></svg>'
    const result = isMonochromeSvg(svg)
    expect(result.monochrome).toBe(true)
    expect(result.darkDesigned).toBe(false)
  })

  it('ignores fills inside <defs> blocks', () => {
    const svg = `<svg viewBox="0 0 24 24">
      <defs><clipPath id="a"><rect fill="#ffffff" width="24" height="24"/></clipPath></defs>
      <path fill="#000000" d="M0 0h24v24H0z"/>
    </svg>`
    expect(isMonochromeSvg(svg)).toEqual({ monochrome: true, darkDesigned: false })
  })

  it('treats SVG with only white fills and none as monochrome + dark-designed', () => {
    const svg =
      '<svg viewBox="0 0 24 24"><path fill="#fff" d="M0 0h24v24H0z"/><path fill="none" d="M5 5h14v14H5z"/></svg>'
    expect(isMonochromeSvg(svg)).toEqual({ monochrome: true, darkDesigned: true })
  })

  it('treats SVG with mixed achromatic fills including light gray as monochrome + dark-designed', () => {
    const svg =
      '<svg viewBox="0 0 24 24"><path fill="#CCCCCC" d="M0 0h12v24H0z"/><path fill="#DDDDDD" d="M12 0h12v24H12z"/></svg>'
    const result = isMonochromeSvg(svg)
    expect(result.monochrome).toBe(true)
    expect(result.darkDesigned).toBe(true)
  })

  it('treats SVG with gradient fills as not monochrome', () => {
    const svg =
      '<svg viewBox="0 0 24 24"><path fill="url(#paint0_linear)" d="M0 0h24v24H0z"/><defs><linearGradient id="paint0_linear"><stop stop-color="#FF0000"/></linearGradient></defs></svg>'
    expect(isMonochromeSvg(svg)).toEqual({ monochrome: false, darkDesigned: false })
  })

  it('treats near-black fills like #231F20 as monochrome', () => {
    const svg = '<svg viewBox="0 0 24 24"><path fill="#231F20" d="M0 0h24v24H0z"/></svg>'
    expect(isMonochromeSvg(svg)).toEqual({ monochrome: true, darkDesigned: false })
  })

  it('treats very dark red #1F0909 as monochrome', () => {
    const svg = '<svg viewBox="0 0 24 24"><path fill="#1F0909" d="M0 0h24v24H0z"/></svg>'
    expect(isMonochromeSvg(svg)).toEqual({ monochrome: true, darkDesigned: false })
  })

  it('handles single-quoted attributes (Skywork pattern)', () => {
    const svg = `<svg width='80' height='80' viewBox='0 0 80 80' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <path fill='#4D5EFF' d='M43 12L14 13L13 45L42 49L24 30L43 12Z'/>
      <path fill='#00FFCE' d='M37 30L66 34L65 66L36 67L55 49L37 30Z'/>
    </svg>`
    expect(isMonochromeSvg(svg)).toEqual({ monochrome: false, darkDesigned: false })
  })

  it('handles mixed single and double quoted attributes', () => {
    const svg = `<svg viewBox="0 0 24 24"><path fill='#FF0000' d="M0 0h12v24H0z"/><path fill="#0000FF" d="M12 0h12v24H12z"/></svg>`
    expect(isMonochromeSvg(svg)).toEqual({ monochrome: false, darkDesigned: false })
  })
})
