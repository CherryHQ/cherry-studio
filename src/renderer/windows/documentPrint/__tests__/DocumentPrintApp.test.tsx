import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import i18n, { initI18n } from '@renderer/i18n/resolver'
import type { DocumentPrintPayload } from '@shared/ipc/schemas/print'

import DocumentPrintApp from '../DocumentPrintApp'
import { remarkPrintImages } from '../documentPrintMarkdown'

vi.mock('@cherrystudio/ui', async (importOriginal) => (importOriginal as () => Promise<typeof CherryStudioUi>)())

const imageData = 'data:image/png;base64,iVBORw0KGgo='
const request = vi.fn()
const decode = vi.fn()

describe('document print window', () => {
  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, { api: { ipcApi: { request, on: () => () => {} } } })
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: decode })
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
    decode.mockResolvedValue(undefined)
  })

  afterEach(cleanup)

  it('renders chat Markdown, math, and highlighted code before signalling readiness after fonts and images settle', async () => {
    const fonts = Promise.withResolvers<void>()
    const image = Promise.withResolvers<void>()
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: fonts.promise } })
    decode.mockReturnValue(image.promise)
    const payload: DocumentPrintPayload = {
      title: 'Document export',
      markdown:
        '# 中文文档\n\n| Name | Value |\n| --- | --- |\n| Cherry | 42 |\n\n\\(x^2\\)\n\n$$a+b$$\n\n```js\nconst answer = 42\n```\n\n![Chart](images/chart.png)\n\n<b>Safe HTML</b>\n\n<table><tr><td>HTML table</td></tr></table>\n\n<script>window.printInjected = true</script>\n\n<style>body{display:none}</style>',
      images: { 'images/chart.png': imageData }
    }
    request.mockImplementation((route: string) =>
      Promise.resolve({ ok: true, data: route === 'window.get_init_data' ? payload : undefined })
    )

    render(<DocumentPrintApp />)

    expect(await screen.findByRole('heading', { name: '中文文档' })).toBeInTheDocument()
    expect(screen.getAllByRole('table')[0]).toHaveTextContent('Cherry42')
    expect(screen.getAllByRole('table')[1]).toHaveTextContent('HTML table')
    expect(screen.getByText('Safe HTML').tagName).toBe('B')
    expect(screen.queryByText('body{display:none}')).not.toBeInTheDocument()
    expect(screen.queryByText('window.printInjected = true')).not.toBeInTheDocument()
    expect(screen.getAllByRole('math', { hidden: true })).toHaveLength(2)
    expect(screen.getByRole('img', { name: 'Chart' })).toHaveAttribute('src', imageData)
    expect(screen.getAllByRole('img')).toHaveLength(1)
    await waitFor(() => expect(decode).toHaveBeenCalled())
    expect(request).not.toHaveBeenCalledWith('print.document.ready', expect.anything())

    await act(async () => {
      image.resolve()
    })
    expect(request).not.toHaveBeenCalledWith('print.document.ready', expect.anything())
    await act(async () => {
      fonts.resolve()
    })

    await waitFor(() => expect(request).toHaveBeenCalledWith('print.document.ready', {}))
    expect(document.title).toBe('Document export')
  })

  it('resolves file and reference images before URL sanitization', () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkPrintImages, { images: { 'file:///workspace/chart.png': imageData } })
    const tree = processor.runSync(processor.parse('![Chart][chart]\n\n[chart]: file:///workspace/chart.png'))

    expect(tree.children[0]).toMatchObject({
      type: 'paragraph',
      children: [{ type: 'image', url: imageData, alt: 'Chart' }]
    })
  })

  it('rejects an image missing from the verified asset map', () => {
    const processor = unified().use(remarkParse).use(remarkPrintImages, { images: {} })
    expect(() => processor.runSync(processor.parse('![Unknown](https://untrusted.invalid/image.png)'))).toThrow(
      'Document contains an unverified image'
    )
  })

  it('matches encoded image paths and remains safe when the Markdown pipeline reuses parsed nodes', () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkPrintImages, { images: { '%E5%9B%BE%E7%89%87.png': imageData } })
    const parsed = processor.parse('![Chart](图片.png)')
    const rendered = processor.runSync(parsed)
    expect(processor.runSync(rendered).children[0]).toMatchObject({
      children: [{ type: 'image', url: imageData }]
    })
  })

  it('reports failed image decoding instead of printing a broken image', async () => {
    decode.mockRejectedValue(new Error('Image decoding failed'))
    request.mockImplementation((route: string) =>
      Promise.resolve({
        ok: true,
        data:
          route === 'window.get_init_data'
            ? {
                title: 'Broken image',
                markdown: '![Chart](chart.png)',
                images: { 'chart.png': imageData }
              }
            : undefined
      })
    )

    render(<DocumentPrintApp />)

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('print.document.ready', { error: 'Image decoding failed' })
    )
    expect(request).not.toHaveBeenCalledWith('print.document.ready', {})
  })
})
