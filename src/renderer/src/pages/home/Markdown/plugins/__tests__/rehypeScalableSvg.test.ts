import rehypeParse from 'rehype-parse'
import rehypeStringify from 'rehype-stringify'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'

import rehypeScalableSvg from '../rehypeScalableSvg'

const processHtml = (html: string): string => {
  return unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeScalableSvg)
    .use(rehypeStringify)
    .processSync(html)
    .toString()
}

const createSvgHtml = (attributes: Record<string, string>): string => {
  const attrs = Object.entries(attributes)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ')
  return `<svg ${attrs}></svg>`
}

describe('rehypeScalableSvg', () => {
  describe('simple SVG cases', () => {
    it('should add viewBox when missing numeric width and height', () => {
      const html = createSvgHtml({ width: '100', height: '50' })
      const result = processHtml(html)

      expect(result).toContain('viewBox="0 0 100 50"')
      expect(result).toContain('width="100%"')
      expect(result).not.toContain('height=')
      expect(result).toContain('max-width: 100')
    })

    it('should preserve existing viewBox and original dimensions', () => {
      const html = createSvgHtml({ width: '100', height: '50', viewBox: '0 0 100 50' })
      const result = processHtml(html)

      expect(result).toContain('viewBox="0 0 100 50"')
      expect(result).toContain('width="100"')
      expect(result).toContain('height="50"')
      expect(result).toContain('max-width: 100')
    })

    it('should handle different viewBox values and preserve original dimensions', () => {
      const html = createSvgHtml({ width: '200', height: '100', viewBox: '10 20 180 80' })
      const result = processHtml(html)

      expect(result).toContain('viewBox="10 20 180 80"')
      expect(result).toContain('width="200"')
      expect(result).toContain('height="100"')
      expect(result).toContain('max-width: 200')
    })

    it('should handle numeric width and height as strings', () => {
      const html = createSvgHtml({ width: '300', height: '150' })
      const result = processHtml(html)

      expect(result).toContain('viewBox="0 0 300 150"')
      expect(result).toContain('width="100%"')
      expect(result).not.toContain('height=')
      expect(result).toContain('max-width: 300')
    })

    it('should handle decimal numeric values', () => {
      const html = createSvgHtml({ width: '100.5', height: '50.25' })
      const result = processHtml(html)

      expect(result).toContain('viewBox="0 0 100.5 50.25"')
      expect(result).toContain('width="100%"')
      expect(result).not.toContain('height=')
      expect(result).toContain('max-width: 100.5')
    })
  })

  describe('complex SVG cases', () => {
    it('should flag SVGs with units for runtime measurement', () => {
      const html = createSvgHtml({ width: '100px', height: '50px' })
      const result = processHtml(html)

      expect(result).toContain('data-needs-measurement="true"')
      expect(result).toContain('width="100px"')
      expect(result).toContain('height="50px"')
      expect(result).toContain('max-width: 100px')
      expect(result).not.toContain('viewBox=')
    })

    it('should handle various CSS units', () => {
      const units = ['px', 'pt', 'em', 'rem', '%', 'cm', 'mm']

      units.forEach((unit) => {
        const html = createSvgHtml({ width: `100${unit}`, height: `50${unit}` })
        const result = processHtml(html)

        expect(result).toContain('data-needs-measurement="true"')
        expect(result).toContain(`width="100${unit}"`)
        expect(result).toContain(`height="50${unit}"`)
        expect(result).toContain(`max-width: 100${unit}`)
        expect(result).not.toContain('viewBox=')
      })
    })

    it('should handle mixed unit types', () => {
      const html = createSvgHtml({ width: '100px', height: '2em' })
      const result = processHtml(html)

      expect(result).toContain('data-needs-measurement="true"')
      expect(result).toContain('width="100px"')
      expect(result).toContain('height="2em"')
      expect(result).toContain('max-width: 100px')
      expect(result).not.toContain('viewBox=')
    })

    it('should handle SVGs with only width (no height)', () => {
      const html = createSvgHtml({ width: '100px' })
      const result = processHtml(html)

      expect(result).not.toContain('data-needs-measurement="true"')
      expect(result).toContain('width="100px"')
      expect(result).toContain('max-width: 100px')
      expect(result).not.toContain('viewBox=')
    })

    it('should handle SVGs with only height (no width)', () => {
      const html = createSvgHtml({ height: '50px' })
      const result = processHtml(html)

      expect(result).not.toContain('data-needs-measurement="true"')
      expect(result).toContain('height="50px"')
      expect(result).not.toContain('max-width:')
      expect(result).not.toContain('viewBox=')
    })
  })

  describe('edge cases', () => {
    it('should handle SVG with no properties object', () => {
      // Create HTML that will result in an SVG element with no properties
      const html = '<svg></svg>'
      const result = processHtml(html)

      // The plugin should handle undefined properties gracefully
      expect(result).toBe('<svg></svg>')
    })

    it('should handle SVG with no dimensions', () => {
      const html = '<svg></svg>'
      const result = processHtml(html)

      expect(result).not.toContain('width="')
      expect(result).not.toContain('height=')
      expect(result).not.toContain('viewBox=')
      expect(result).not.toContain('data-needs-measurement="true"')
      expect(result).not.toContain('max-width:')
    })

    it('should handle SVG with whitespace-only dimensions', () => {
      const html = createSvgHtml({ width: ' ', height: '  ' })
      const result = processHtml(html)

      expect(result).not.toContain('data-needs-measurement="true"')
      expect(result).toContain('width=" "')
      expect(result).toContain('height="  "')
      expect(result).not.toContain('max-width:')
      expect(result).not.toContain('viewBox=')
    })

    it('should handle SVG with non-numeric strings', () => {
      const html = createSvgHtml({ width: 'auto', height: 'inherit' })
      const result = processHtml(html)

      expect(result).toContain('data-needs-measurement="true"')
      expect(result).toContain('width="auto"')
      expect(result).toContain('height="inherit"')
      expect(result).toContain('max-width: auto')
      expect(result).not.toContain('viewBox=')
    })

    it('should handle SVG with mixed numeric and non-numeric values', () => {
      const html = createSvgHtml({ width: '100', height: 'auto' })
      const result = processHtml(html)

      expect(result).toContain('data-needs-measurement="true"')
      expect(result).toContain('width="100"')
      expect(result).toContain('height="auto"')
      expect(result).toContain('max-width: 100')
      expect(result).not.toContain('viewBox=')
    })
  })

  describe('style handling', () => {
    it('should append to existing style attribute for simple SVG', () => {
      const html = createSvgHtml({
        width: '100',
        height: '50',
        style: 'fill: red; stroke: blue'
      })
      const result = processHtml(html)

      expect(result).toContain('style="fill: red; stroke: blue; max-width: 100"')
      expect(result).toContain('viewBox="0 0 100 50"')
      expect(result).toContain('width="100%"')
    })

    it('should handle style attribute with trailing semicolon for simple SVG', () => {
      const html = createSvgHtml({
        width: '100',
        height: '50',
        style: 'fill: red;'
      })
      const result = processHtml(html)

      expect(result).toContain('style="fill: red; max-width: 100"')
      expect(result).toContain('viewBox="0 0 100 50"')
    })

    it('should handle empty style attribute for simple SVG', () => {
      const html = createSvgHtml({
        width: '100',
        height: '50',
        style: ''
      })
      const result = processHtml(html)

      expect(result).toContain('style="max-width: 100"')
      expect(result).toContain('viewBox="0 0 100 50"')
    })

    it('should handle style with only whitespace for simple SVG', () => {
      const html = createSvgHtml({
        width: '100',
        height: '50',
        style: ' '
      })
      const result = processHtml(html)

      expect(result).toContain('style="max-width: 100"')
      expect(result).toContain('viewBox="0 0 100 50"')
    })

    it('should preserve complex style attributes for complex SVG', () => {
      const html = createSvgHtml({
        width: '100px',
        height: '50px',
        style: 'fill: url(#gradient); stroke: #333; stroke-width: 2;'
      })
      const result = processHtml(html)

      expect(result).toContain('style="fill: url(#gradient); stroke: #333; stroke-width: 2; max-width: 100px"')
      expect(result).toContain('data-needs-measurement="true"')
      expect(result).toContain('width="100px"')
      expect(result).toContain('height="50px"')
    })
  })

  describe('HTML structure handling', () => {
    it('should only process SVG elements', () => {
      const html = '<div width="100" height="50"></div>'
      const result = processHtml(html)

      expect(result).toBe('<div width="100" height="50"></div>')
    })

    it('should process multiple SVG elements in one document', () => {
      const html = `
        <svg width="100" height="50"></svg>
        <svg width="200px" height="100px"></svg>
        <svg viewBox="0 0 300 150" width="300" height="150"></svg>
      `
      const result = processHtml(html)

      expect(result).toContain('viewBox="0 0 100 50"')
      expect(result).toContain('data-needs-measurement="true"')
      expect(result).toContain('viewBox="0 0 300 150"')
    })

    it('should handle nested SVG elements', () => {
      const html = `
        <svg width="200" height="200">
          <svg width="100" height="100"></svg>
        </svg>
      `
      const result = processHtml(html)

      expect(result).toContain('viewBox="0 0 200 200"')
      expect(result).toContain('viewBox="0 0 100 100"')
    })

    it('should handle SVG with other attributes', () => {
      const html = createSvgHtml({
        width: '100',
        height: '50',
        id: 'test-svg',
        class: 'svg-class',
        'data-custom': 'value'
      })
      const result = processHtml(html)

      expect(result).toContain('id="test-svg"')
      expect(result).toContain('class="svg-class"')
      expect(result).toContain('data-custom="value"')
      expect(result).toContain('viewBox="0 0 100 50"')
      expect(result).toContain('width="100%"')
    })
  })

  describe('numeric validation', () => {
    it('should correctly identify numeric strings', () => {
      const testCases = [
        { value: '100', expected: true },
        { value: '0', expected: true },
        { value: '-50', expected: true },
        { value: '3.14', expected: true },
        { value: '100px', expected: false },
        { value: 'auto', expected: false },
        { value: '', expected: false },
        { value: ' ', expected: false },
        { value: '100 ', expected: true },
        { value: ' 100', expected: true },
        { value: ' 100 ', expected: true }
      ]

      testCases.forEach(({ value, expected }) => {
        const html = createSvgHtml({ width: value, height: '50' })
        const result = processHtml(html)

        if (expected && value.trim() !== '') {
          expect(result).toContain('viewBox="0 0 ' + value.trim() + ' 50"')
        } else if (value.trim() === '') {
          expect(result).not.toContain('viewBox=')
        } else {
          expect(result).toContain('data-needs-measurement="true"')
        }
      })
    })
  })
})
