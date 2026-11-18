import { describe, expect, it } from 'vitest'

import {
  isRemotePptdSource,
  loadPptdProject,
  parsePptdElement,
  parsePptdPage,
  parsePptdPresentation
} from '../pptdProject'
import { normalizePptdRichText, resolvePptdTextStyle, splitPptdMathSegments } from '../pptdRichText'
import { pptdColorToCss, pptdFillToCss } from '../pptdStyle'

const encoder = new TextEncoder()

describe('parsePptdPresentation', () => {
  it('parses a minimal manifest', () => {
    const manifest = parsePptdPresentation(encoder.encode('version: v2\nsize: [960, 540]\npages:\n  - pages/1.page\n'))
    expect(manifest.size).toEqual([960, 540])
    expect(manifest.pages).toEqual(['pages/1.page'])
  })

  it('rejects a manifest without pages', () => {
    expect(() => parsePptdPresentation(encoder.encode('version: v2\nsize: [960, 540]\n'))).toThrow()
  })
})

describe('parsePptdPage', () => {
  it('keeps invalid elements as placeholders instead of dropping them', () => {
    const page = parsePptdPage(
      encoder.encode(
        [
          'elements:',
          '  - elementId: ok-1',
          '    elementType: text',
          '    bounds: [0, 0, 100, 40]',
          '    content: {text: Hello}',
          '  - elementId: broken-1',
          '    elementType: text',
          '    content: {text: Missing bounds}'
        ].join('\n')
      )
    )
    expect(page.elements).toHaveLength(2)
    expect(page.elements[0].elementType).toBe('text')
    const invalid = page.elements[1]
    expect(invalid.elementType).toBe('invalid')
    if (invalid.elementType === 'invalid') {
      expect(invalid.elementId).toBe('broken-1')
      expect(invalid.declaredType).toBe('text')
      expect(invalid.reason.length).toBeGreaterThan(0)
    }
  })
})

describe('loadPptdProject', () => {
  const manifest = encoder.encode('version: v2\nsize: [960, 540]\npages:\n  - pages/ok.page\n  - pages/gone.page\n')
  const document = {
    size: manifest.byteLength,
    revision: 'test',
    readRange: async (offset: number, length: number) => manifest.slice(offset, offset + length),
    close: async () => {}
  }

  it('marks missing pages without failing the deck', async () => {
    const project = await loadPptdProject(document, async (path) => {
      if (path === 'pages/ok.page') {
        return encoder.encode(
          'elements:\n  - elementId: t1\n    elementType: text\n    bounds: [0,0,10,10]\n    content: {text: Hi}\n'
        )
      }
      throw new Error('ENOENT')
    })
    expect(project.pages[0].status).toBe('ok')
    expect(project.pages[1]).toMatchObject({ status: 'missing', path: 'pages/gone.page' })
  })
})

describe('theme color resolution', () => {
  const context = { theme: { colors: { primary: '#2563EB' } } }

  it('resolves $references and converts HEX8 alpha', () => {
    expect(pptdColorToCss('$primary', context)).toBe('#2563EB')
    expect(pptdColorToCss('#00000040', context)).toBe('rgba(0, 0, 0, 0.251)')
    expect(pptdColorToCss('$missing', context)).toBeUndefined()
  })

  it('builds linear gradients with the upstream angle convention', () => {
    const css = pptdFillToCss(
      {
        type: 'gradient',
        gradientType: 'linear',
        angle: 90,
        stops: [
          { position: 0, color: '$primary' },
          { position: 1, color: '#F59E0B' }
        ]
      },
      context
    )
    expect(css?.background).toBe('linear-gradient(180deg, #2563EB 0%, #F59E0B 100%)')
  })
})

describe('text style priority', () => {
  it('merges defaults, theme style, then content fields', () => {
    const context = { theme: { textStyles: { title: { fontSize: 40, color: '#111111', bold: true } } } }
    const style = resolvePptdTextStyle({ text: 'Hi', style: '$title', color: '#222222' }, context)
    expect(style).toMatchObject({ fontSize: 40, bold: true, color: '#222222', fontFamily: 'MiSans', lineHeight: 1 })
  })

  it('ignores unknown theme style references', () => {
    const style = resolvePptdTextStyle({ text: 'Hi', style: '$nope' }, {})
    expect(style.fontSize).toBe(18)
  })
})

describe('rich text helpers', () => {
  it('splits plain text shorthand into paragraphs', () => {
    expect(normalizePptdRichText('First line\nSecond line')).toBe('<p>First line</p><p>Second line</p>')
  })

  it('escapes angle brackets in the shorthand but keeps math delimiters', () => {
    expect(normalizePptdRichText('a < b')).toBe('<p>a &lt; b</p>')
    expect(normalizePptdRichText('E=mc^2 and \\(a^2+b^2=c^2\\)')).toBe('<p>E=mc^2 and \\(a^2+b^2=c^2\\)</p>')
  })

  it('splits math segments on the \\) delimiter, not plain parens', () => {
    const segments = splitPptdMathSegments('x \\(f(a) + g(b)\\) y')
    expect(segments).toEqual([
      { kind: 'text', value: 'x ' },
      { kind: 'math', value: 'f(a) + g(b)' },
      { kind: 'text', value: ' y' }
    ])
  })
})

describe('remote media detection', () => {
  it('treats https sources as remote and everything else as local', () => {
    expect(isRemotePptdSource('https://example.com/a.png')).toBe(true)
    expect(isRemotePptdSource('media/a.png')).toBe(false)
    expect(isRemotePptdSource('http://example.com/a.png')).toBe(false)
  })
})

describe('built-in shape paths', () => {
  it('generates closed paths for the common built-ins', async () => {
    const { pptdShapePath } = await import('../pptdShapes')
    for (const name of [
      'rect',
      'roundRect',
      'ellipse',
      'triangle',
      'rtTriangle',
      'parallelogram',
      'trapezoid',
      'nonIsoscelesTrapezoid',
      'diamond',
      'pentagon',
      'hexagon',
      'heptagon',
      'octagon',
      'decagon',
      'dodecagon',
      'plus',
      'homePlate',
      'chevron',
      'donut',
      'pie'
    ]) {
      expect(pptdShapePath(name), name).toMatch(/^M/)
    }
  })

  it('honours adjustments and rejects unknown shapes', async () => {
    const { pptdShapePath } = await import('../pptdShapes')
    expect(pptdShapePath('triangle', [0])).toContain('M0,0')
    expect(pptdShapePath('triangle', [100000])).toContain('M100000,0')
    expect(pptdShapePath('flermp')).toBeNull()
  })
})

describe('line paths', () => {
  it('parses points and builds sharp polylines', async () => {
    const { parsePptdLinePoints, pptdLinePath } = await import('../pptdLine')
    const points = parsePptdLinePoints('0,0 50,100 100,0')
    expect(points).toEqual([
      [0, 0],
      [50, 100],
      [100, 0]
    ])
    expect(pptdLinePath(points, 'sharp')).toBe('M0,0L50,100L100,0')
    expect(pptdLinePath(points.slice(0, 1), 'smooth')).toBeNull()
  })

  it('builds quadratic and cubic smooth curves and samples higher degrees', async () => {
    const { parsePptdLinePoints, pptdLinePath } = await import('../pptdLine')
    expect(pptdLinePath(parsePptdLinePoints('0,0 50,100 100,0'), 'smooth')).toBe('M0,0Q50,100 100,0')
    expect(pptdLinePath(parsePptdLinePoints('0,80 120,0 240,100 360,20'), 'smooth')).toBe('M0,80C120,0 240,100 360,20')
    const high = pptdLinePath(parsePptdLinePoints('0,0 20,50 40,0 60,50 80,0'), 'smooth')
    expect(high).toMatch(/^M0,0/)
    expect(high).toMatch(/80,0$/)
  })

  it('drops malformed pairs', async () => {
    const { parsePptdLinePoints } = await import('../pptdLine')
    expect(parsePptdLinePoints('0,0 junk 10,10')).toEqual([
      [0, 0],
      [10, 10]
    ])
  })
})

describe('image crop and fit math', () => {
  it('covers the box with the cropped sub-image', async () => {
    const { pptdImageRect } = await import('../pptdImage')
    // 400x200 source cropped 25% left+right -> 200x200 sub-image in a 100x100 box: cover scales x1
    const rect = pptdImageRect(400, 200, 100, 100, { left: 0.25, right: 0.25 }, { mode: 'cover' })
    expect(rect).toEqual({ x: -100, y: 0, width: 200, height: 100 })
  })

  it('contain letterboxes and fill stretches the cropped region', async () => {
    const { pptdImageRect } = await import('../pptdImage')
    const contain = pptdImageRect(200, 100, 100, 100, undefined, { mode: 'contain' })
    expect(contain).toEqual({ x: 0, y: 25, width: 100, height: 50 })
    const fill = pptdImageRect(400, 200, 100, 100, { top: 0.5 }, { mode: 'fill' })
    expect(fill).toEqual({ x: 0, y: -100, width: 100, height: 200 })
  })

  it('defaults to cover and rejects degenerate inputs', async () => {
    const { pptdImageRect } = await import('../pptdImage')
    expect(pptdImageRect(100, 100, 100, 50, undefined, undefined)).toEqual({ x: 0, y: -25, width: 100, height: 100 })
    expect(pptdImageRect(100, 100, 100, 50, { left: 0.6, right: 0.6 }, undefined)).toBeNull()
    expect(pptdImageRect(0, 100, 100, 50, undefined, undefined)).toBeNull()
  })
})

describe('icon name parsing', () => {
  it('accepts the documented styles and CDN-safe names', async () => {
    const { parsePptdIconName, pptdIconUrl } = await import('../pptdIcon')
    expect(parsePptdIconName('fas:house')).toEqual({ style: 'fas', name: 'house' })
    expect(parsePptdIconName('far:heart')).toEqual({ style: 'far', name: 'heart' })
    expect(pptdIconUrl('fab', 'github')).toContain('/svgs/brands/github.svg')
    expect(parsePptdIconName('fal:house')).toBeNull()
    expect(parsePptdIconName('fas:../secret')).toBeNull()
    expect(parsePptdIconName('fas:')).toBeNull()
    expect(parsePptdIconName('house')).toBeNull()
  })
})
