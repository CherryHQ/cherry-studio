import { describe, expect, it } from 'vitest'

import { isRemotePptdSource, loadPptdProject, parsePptdPage, parsePptdPresentation } from '../pptdProject'
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

  it('rethrows cancellation instead of converting it into a missing page', async () => {
    const controller = new AbortController()
    const aborted = new DOMException('Aborted', 'AbortError')
    controller.abort(aborted)
    await expect(
      loadPptdProject(
        document,
        async () => {
          throw aborted
        },
        controller.signal
      )
    ).rejects.toBe(aborted)
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

  it('defaults text color to black on the white slide surface', () => {
    const style = resolvePptdTextStyle({ text: 'Hi' }, {})
    expect(style.color).toBe('#000000')
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
    // 400x200 source cropped 25% left+right -> 200x200 sub-image in a 100x100 box: cover scales x1,
    // and the box centers the SUB-image (source x 100-300), so x = -(0.25 * 400 * 0.5) = -50.
    const rect = pptdImageRect(400, 200, 100, 100, { left: 0.25, right: 0.25 }, { mode: 'cover' })
    expect(rect).toEqual({ x: -50, y: 0, width: 200, height: 100 })
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

describe('table placement and styles', () => {
  it('skips positions covered by merged regions', async () => {
    const { placePptdTableCells } = await import('../pptdTable')
    const rows = [
      [{ text: 'Merged', rowSpan: 2, colSpan: 2 }, { text: 'C1' }],
      [{ text: 'C2' }],
      [{ text: 'A3' }, { text: 'B3' }, { text: 'C3' }]
    ]
    const placements = placePptdTableCells(rows)
    expect(placements.map((p) => [p.row, p.col])).toEqual([
      [0, 0],
      [0, 2],
      [1, 2],
      [2, 0],
      [2, 1],
      [2, 2]
    ])
  })

  it('applies the category chain with rowOverColumn and body cycling', async () => {
    const { resolvePptdCellCategoryStyle } = await import('../pptdTable')
    const config = {
      cellStyle: { color: '#111111', bold: false },
      firstRowStyle: { bold: true, color: '#222222' },
      firstColumnStyle: { color: '#333333' },
      bodyStyles: [{ color: '#444444' }, { color: '#555555' }]
    }
    // First row + first column: row wins by default
    expect(resolvePptdCellCategoryStyle(config, 0, 0, 4, 3)).toMatchObject({ color: '#222222', bold: true })
    // First row + first column, column wins when rowOverColumn is false
    expect(resolvePptdCellCategoryStyle({ ...config, rowOverColumn: false }, 0, 0, 4, 3)).toMatchObject({
      color: '#333333',
      bold: true
    })
    // Body rows cycle bodyStyles by data-row index
    expect(resolvePptdCellCategoryStyle(config, 1, 1, 4, 3)).toMatchObject({ color: '#444444' })
    expect(resolvePptdCellCategoryStyle(config, 2, 1, 4, 3)).toMatchObject({ color: '#555555' })
    // Last row has no body style
    expect(resolvePptdCellCategoryStyle(config, 3, 1, 4, 3)).toMatchObject({ color: '#111111' })
  })

  it('layers defaults, categories, the textStyle ref and cell inline fields', async () => {
    const { resolvePptdCellTextStyle } = await import('../pptdTable')
    const context = { theme: { textStyles: { body: { fontSize: 20, color: '#666666' } } } }
    const style = resolvePptdCellTextStyle(
      { text: 'x', textStyle: '$body', color: '#FF0000' },
      { fontSize: 14, bold: true },
      context
    )
    expect(style).toMatchObject({ fontSize: 20, bold: true, color: '#FF0000', fontFamily: 'MiSans' })
  })

  it('expands border specs and clears on null', async () => {
    const { pptdBorderSides } = await import('../pptdTable')
    const border = { style: 'solid' as const, width: 2, color: '#000000' }
    expect(pptdBorderSides(undefined)).toBeUndefined()
    expect(pptdBorderSides(null)).toEqual({ top: null, right: null, bottom: null, left: null })
    expect(pptdBorderSides(border)).toEqual({ top: border, right: border, bottom: border, left: border })
    expect(pptdBorderSides([border, null])).toEqual({ top: border, bottom: border, left: null, right: null })
    expect(pptdBorderSides([border, null, border, null])).toEqual({
      top: border,
      right: null,
      bottom: border,
      left: null
    })
  })
})

describe('chart option building', () => {
  const elementBase = { elementId: 'c1', bounds: [0, 0, 400, 300] as [number, number, number, number] }

  it('builds a bar chart with dataset, theme cycle and percent-ratio widths', async () => {
    const { buildPptdChartOption } = await import('../pptdChart')
    const option = buildPptdChartOption(
      {
        ...elementBase,
        elementType: 'chart',
        data: {
          cols: ['year', 'revenue'],
          rows: [
            ['2023', 82.5],
            ['2024', 96.3]
          ]
        },
        series: [{ type: 'bar', encode: { x: 'year', y: 'revenue' }, fill: '$primary' }],
        barWidth: 0.5,
        title: 'Revenue'
      },
      { theme: { colors: { primary: '#2563EB', accent: '#F59E0B' } } }
    )
    if (!option) throw new Error('expected a chart option')
    expect(option.dataset.source).toEqual([
      ['year', 'revenue'],
      ['2023', 82.5],
      ['2024', 96.3]
    ])
    expect(option.color).toEqual(['#2563EB', '#F59E0B'])
    expect(option.series[0]).toMatchObject({ type: 'bar', barWidth: '50%', itemStyle: { color: '#2563EB' } })
    expect(option.title).toMatchObject({ text: 'Revenue' })
    expect(option.legend).toEqual({ show: false })
  })

  it('infers a category x-axis from string rows and preserves an explicit type', async () => {
    const { buildPptdChartOption } = await import('../pptdChart')
    const categorical = buildPptdChartOption(
      {
        ...elementBase,
        elementType: 'chart',
        data: {
          cols: ['quarter', 'sales'],
          rows: [
            ['Q1', 120],
            ['Q2', 140]
          ]
        },
        series: [{ type: 'bar', encode: { x: 'quarter', y: 'sales' } }]
      },
      {}
    )
    // ECharts would default an untyped axis to 'value' and strand the categories.
    expect(categorical?.xAxis).toMatchObject({ type: 'category' })
    const explicit = buildPptdChartOption(
      {
        ...elementBase,
        elementType: 'chart',
        data: {
          cols: ['quarter', 'sales'],
          rows: [['Q1', 120]]
        },
        series: [{ type: 'bar', encode: { x: 'quarter', y: 'sales' } }],
        xAxis: { type: 'time' }
      },
      {}
    )
    expect(explicit?.xAxis).toMatchObject({ type: 'time' })
  })

  it('shows the legend for multiple series and hides it when disabled', async () => {
    const { buildPptdChartOption } = await import('../pptdChart')
    const data = { cols: ['x', 'a', 'b'], rows: [[1, 2, 3]] }
    const two = buildPptdChartOption(
      {
        ...elementBase,
        elementType: 'chart',
        data,
        series: [
          { type: 'line', encode: { x: 'x', y: 'a' } },
          { type: 'line', encode: { x: 'x', y: 'b' } }
        ]
      },
      {}
    )
    expect(two?.legend).toEqual({ show: true })
    const off = buildPptdChartOption(
      {
        ...elementBase,
        elementType: 'chart',
        data,
        series: [{ type: 'line', encode: { x: 'x', y: 'a' } }],
        legend: false
      },
      {}
    )
    expect(off?.legend).toEqual({ show: false })
  })

  it('maps area to a filled line and converts gradients', async () => {
    const { buildPptdChartOption } = await import('../pptdChart')
    const option = buildPptdChartOption(
      {
        ...elementBase,
        elementType: 'chart',
        data: { cols: ['x', 'y'], rows: [[1, 2]] },
        series: [
          {
            type: 'area',
            encode: { x: 'x', y: 'y' },
            fill: {
              type: 'gradient',
              gradientType: 'linear',
              angle: 90,
              stops: [
                { position: 0, color: '#2563EB' },
                { position: 1, color: '#F59E0B' }
              ]
            }
          }
        ]
      },
      {}
    )
    const series = option?.series[0]
    expect(series.type).toBe('line')
    expect(series.areaStyle.color).toMatchObject({
      type: 'linear',
      x: 0.5,
      y: 0,
      x2: 0.5,
      y2: 1,
      colorStops: [
        { offset: 0, color: '#2563EB' },
        { offset: 1, color: '#F59E0B' }
      ]
    })
  })

  it('returns null for unsupported types and invalid configs', async () => {
    const { buildPptdChartOption } = await import('../pptdChart')
    expect(
      buildPptdChartOption(
        {
          ...elementBase,
          elementType: 'chart',
          data: { cols: ['x', 'y'], rows: [[1, 2]] },
          series: [{ type: 'sankey', encode: { x: 'x', y: 'y' } }]
        },
        {}
      )
    ).toBeNull()
    expect(buildPptdChartOption({ ...elementBase, elementType: 'chart' }, {})).toBeNull()
  })

  it('encodes pie slices by category and value with donut radius', async () => {
    const { buildPptdChartOption } = await import('../pptdChart')
    const option = buildPptdChartOption(
      {
        ...elementBase,
        elementType: 'chart',
        data: {
          cols: ['kind', 'share'],
          rows: [
            ['A', 40],
            ['B', 60]
          ]
        },
        series: [{ type: 'pie', encode: { category: 'kind', value: 'share' }, innerRadius: 0.5 }]
      },
      {}
    )
    expect(option?.series[0]).toMatchObject({
      type: 'pie',
      encode: { itemName: 'kind', value: 'share' },
      radius: ['50%', '70%'],
      startAngle: 90
    })
  })
})
