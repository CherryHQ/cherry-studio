import { describe, expect, it } from 'vitest'

import { htmlArtifactRequiresUserConsent, stripMetaRefresh } from '../htmlArtifact'

describe('htmlArtifactRequiresUserConsent', () => {
  it('allows static inline HTML to render immediately', () => {
    expect(
      htmlArtifactRequiresUserConsent(`
        <main>
          <style>body { color: red; }</style>
          <img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" alt="">
          <h1>Hello</h1>
        </main>
      `)
    ).toBe(false)
  })

  it.each([
    '<script>document.body.textContent = "interactive"</script>',
    '<button onclick="alert(1)">Run</button>',
    '<a href="javascript:alert(1)">Run</a>',
    '<iframe srcdoc="<p>Embedded</p>"></iframe>',
    '<meta http-equiv="refresh" content="0; url=https://example.com">'
  ])('requires consent for active content: %s', (html) => {
    expect(htmlArtifactRequiresUserConsent(html)).toBe(true)
  })

  it.each([
    '<link rel="stylesheet" href="https://example.com/style.css">',
    '<a href="https://example.com">External link</a>',
    '<img src="//example.com/image.png" alt="">',
    '<div style="background-image: url(https://example.com/image.png)"></div>',
    '<style>@import "https://example.com/style.css";</style>',
    '<img src="ht&#x0A;tps://example.com/pixel" alt="">',
    String.raw`<div style="background-image: url(\68 ttps://example.com/image.png)"></div>`,
    String.raw`<style>@import "\68 ttps://example.com/style.css";</style>`
  ])('requires consent for external resources: %s', (html) => {
    expect(htmlArtifactRequiresUserConsent(html)).toBe(true)
  })
})

describe('stripMetaRefresh', () => {
  it('removes meta-refresh tags wherever they appear, keeps other content intact', () => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=https://evil.example"></head><body><noscript><META HTTP-EQUIV='Refresh' CONTENT="1;url=//evil.example/x"></noscript><h1>Redirector</h1></body></html>`

    const stripped = stripMetaRefresh(html)

    expect(stripped.toLowerCase()).not.toContain('http-equiv')
    expect(stripped).toContain('<meta charset="utf-8">')
    expect(stripped).toContain('<h1>Redirector</h1>')
    expect(stripped.toLowerCase()).toContain('<!doctype html>')
  })

  it('returns html without any meta tag unchanged', () => {
    const html = '<div><h2>Fragment</h2></div>'
    expect(stripMetaRefresh(html)).toBe(html)
  })

  it('neutralizes incorrectly-closed comments so a hidden meta cannot re-open in browsers', () => {
    // Browsers close the comment at `--!>` (htmlparser2 does not): without breaking
    // the sequence the meta would become live script-side of the comment again.
    const html = '<div>a</div><!--c--!><meta http-equiv="refresh" content="0;url=https://evil.example">'

    const stripped = stripMetaRefresh(html)

    expect(stripped).not.toMatch(/--!>/)
    expect(stripped).toContain('<div>a</div>')
  })
})
