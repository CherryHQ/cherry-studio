import { describe, expect, it } from 'vitest'

import { scanStandaloneHtmlArtifact } from '../standaloneHtmlArtifact'

describe('scanStandaloneHtmlArtifact', () => {
  it('recognizes a complete HTML document without parsing Markdown', () => {
    expect(scanStandaloneHtmlArtifact('  <!doctype html><html><body>hello</body></html>\n')).toMatchObject({
      html: '<!doctype html><html><body>hello</body></html>',
      kind: 'document',
      source: 'document'
    })
  })

  it('recognizes a standalone HTML fence', () => {
    expect(scanStandaloneHtmlArtifact('```html\n<section>hello</section>\n```')).toMatchObject({
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
    expect(scanStandaloneHtmlArtifact(source, true)).toMatchObject({
      html: source,
      kind: 'document',
      source: 'document'
    })
  })

  it('accepts an incomplete HTML fence only while streaming', () => {
    const source = '```html\n<div>still streaming'
    expect(scanStandaloneHtmlArtifact(source)).toBeUndefined()
    expect(scanStandaloneHtmlArtifact(source, true)).toMatchObject({
      html: '<div>still streaming',
      kind: 'fragment',
      source: 'fence'
    })
  })

  it('rejects a closed fence followed by a streamed Markdown tail', () => {
    const source = '```html\n<div>hello</div>\n```\n\nAnd here is what it does.'
    expect(scanStandaloneHtmlArtifact(source, true)).toBeUndefined()
    expect(scanStandaloneHtmlArtifact(source)).toBeUndefined()
  })

  it('rejects a closed document followed by a streamed Markdown tail', () => {
    const source = '<!doctype html><html><body>hi</body></html>\n\nHope that helps.'
    expect(scanStandaloneHtmlArtifact(source, true)).toBeUndefined()
    expect(scanStandaloneHtmlArtifact(source)).toBeUndefined()
  })

  it('reports the real opening position so code-block saves keep matching', () => {
    const artifact = scanStandaloneHtmlArtifact('\n\n```html\n<div>hi</div>\n```')
    expect(artifact?.start).toEqual({ line: 3, column: 1, offset: 2 })
  })

  it('reads the fence body up to a closing marker that carries trailing whitespace', () => {
    expect(scanStandaloneHtmlArtifact('```html\n<div>a</div>\n```   ')).toMatchObject({ html: '<div>a</div>' })
  })
})
