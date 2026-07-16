import { BaseService } from '@main/core/lifecycle'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../readableContentWorker?nodeWorker', async () => {
  const { Worker } = await import('node:worker_threads')

  return {
    default: (options: ConstructorParameters<typeof Worker>[1]) =>
      new Worker(`${process.cwd()}/src/main/services/readableContent/readableContentWorker.ts`, options)
  }
})

import { ReadableContentService } from '../ReadableContentService'

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

describe('ReadableContentService integration', () => {
  let service: ReadableContentService

  beforeEach(async () => {
    BaseService.resetInstances()
    service = new ReadableContentService()
    await service._doInit()
  })

  afterEach(async () => {
    if (!service.isStopped && !service.isDestroyed) {
      await service._doStop()
    }
    BaseService.resetInstances()
  })

  it('extracts a title and readable markdown in a real worker', async () => {
    await expect(service.extractReadableMarkdown(ARTICLE_HTML)).resolves.toEqual({
      title: 'Example article',
      content: 'Readable headline\n-----------------\n\nThe primary sentence is extracted from the article body.'
    })
  })

  it('cleans and truncates preview text in a real worker', async () => {
    const body = `![hero](https://example.com/hero.png)\n[Visible](https://example.com/link)\nhttps://hidden.test --- ${'x'.repeat(110)}`

    await expect(service.extractPreviewText(body, { inputKind: 'text', maxLength: 100 })).resolves.toBe(
      `Visible ${'x'.repeat(92)}...`
    )
  })

  it('keeps the main event loop responsive while parsing large HTML', async () => {
    const paragraph = '<p>Readable worker regression content.</p>'
    const html = `<!doctype html><html><body><article>${paragraph.repeat(10_000)}</article></body></html>`
    let settled = false

    const extraction = service.extractReadableMarkdown(html).finally(() => {
      settled = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(settled).toBe(false)
    await expect(extraction).resolves.toMatchObject({
      content: expect.stringContaining('Readable worker regression content')
    })
  })

  it('keeps the main event loop responsive while cleaning adversarial preview text', async () => {
    const token = '![unclosed'
    const source = token.repeat(Math.ceil((1024 * 1024) / token.length))
    let settled = false

    const extraction = service.extractPreviewText(source, { inputKind: 'text', maxLength: 100 }).finally(() => {
      settled = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(settled).toBe(false)
    await expect(extraction).resolves.toHaveLength(103)
  })
})
