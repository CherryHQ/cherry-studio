import { describe, expect, it } from 'vitest'

import { extractReadableMarkdown, extractReadableText } from '../readableContent'

const ARTICLE_HTML = `
  <!doctype html>
  <html>
    <head><title>Example article</title></head>
    <body>
      <nav>Navigation outside the article</nav>
      <article>
        <h1>Readable headline</h1>
        <p>The primary sentence is extracted from the article body.</p>
      </article>
      <footer>Footer outside the article</footer>
    </body>
  </html>
`

describe('readableContent', () => {
  it('extracts readable plain text in a worker', async () => {
    const text = await extractReadableText(ARTICLE_HTML)

    expect(text).toContain('Readable headline')
    expect(text).toContain('The primary sentence is extracted from the article body.')
    expect(text).not.toContain('Navigation outside the article')
  })

  it('extracts a title and markdown in a worker', async () => {
    await expect(extractReadableMarkdown(ARTICLE_HTML)).resolves.toEqual({
      title: 'Example article',
      content: 'Readable headline\n-----------------\n\nThe primary sentence is extracted from the article body.'
    })
  })

  it('keeps the main event loop responsive while parsing large HTML', async () => {
    const paragraph = '<p>Readable worker regression content.</p>'
    const html = `<!doctype html><html><body><article>${paragraph.repeat(10_000)}</article></body></html>`
    let settled = false

    const extraction = extractReadableText(html).finally(() => {
      settled = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(settled).toBe(false)
    await expect(extraction).resolves.toContain('Readable worker regression content')
  })
})
