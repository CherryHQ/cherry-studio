import { describe, expect, it } from 'vitest'

import { scanStandaloneHtmlArtifact } from '../standaloneHtmlArtifact'

describe('scanStandaloneHtmlArtifact', () => {
  it('recognizes a complete HTML document without parsing Markdown', () => {
    expect(scanStandaloneHtmlArtifact('  <!doctype html><html><body>hello</body></html>\n')).toEqual({
      html: '<!doctype html><html><body>hello</body></html>',
      kind: 'document',
      source: 'document'
    })
  })

  it('recognizes a standalone HTML fence', () => {
    expect(scanStandaloneHtmlArtifact('```html\n<section>hello</section>\n```')).toEqual({
      html: '<section>hello</section>',
      kind: 'fragment',
      source: 'fence'
    })
  })

  it('keeps mixed Markdown on the general renderer path', () => {
    expect(scanStandaloneHtmlArtifact('Before\n\n```html\n<div>hello</div>\n```')).toBeUndefined()
    expect(scanStandaloneHtmlArtifact('<div>fragment</div>')).toBeUndefined()
  })

  it('accepts an incomplete document only while streaming', () => {
    const source = '<!doctype html><html><body>still streaming'
    expect(scanStandaloneHtmlArtifact(source)).toBeUndefined()
    expect(scanStandaloneHtmlArtifact(source, true)).toEqual({ html: source, kind: 'document', source: 'document' })
  })

  it('accepts an incomplete HTML fence only while streaming', () => {
    const source = '```html\n<div>still streaming'
    expect(scanStandaloneHtmlArtifact(source)).toBeUndefined()
    expect(scanStandaloneHtmlArtifact(source, true)).toEqual({
      html: '<div>still streaming',
      kind: 'fragment',
      source: 'fence'
    })
  })
})
