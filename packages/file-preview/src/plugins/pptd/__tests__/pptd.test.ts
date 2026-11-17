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
