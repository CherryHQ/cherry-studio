import { describe, expect, it } from 'vitest'

import { htmlArtifactRequiresUserConsent } from '../htmlArtifact'

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
    '<style>@import "https://example.com/style.css";</style>'
  ])('requires consent for external resources: %s', (html) => {
    expect(htmlArtifactRequiresUserConsent(html)).toBe(true)
  })
})
