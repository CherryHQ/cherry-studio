import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { printService } from '../../PrintService'
import { convertDocumentBundle } from '../convertDocument'
import * as HtmlModule from '../html'

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    png: () => ({
      toBuffer: async () => Buffer.alloc(10 * 1024 * 1024 + 1)
    })
  }))
}))

vi.mock('../html', async () => {
  const actual = await vi.importActual<typeof HtmlModule>('../html')
  return {
    ...actual,
    renderStaticHtml: vi.fn(async (html: string, pdf: boolean, signal?: AbortSignal) => {
      signal?.throwIfAborted()
      if (pdf) return Buffer.from('%PDF')
      const { JSDOM } = await import('jsdom')
      const dom = new JSDOM(html)
      try {
        const document = dom.window.document
        const blocks: Array<
          { type: 'heading'; level: number; text: string } | { type: 'image'; source: string; text: string }
        > = []
        const heading = document.querySelector('h1')?.textContent?.trim()
        if (heading) blocks.push({ type: 'heading', level: 1, text: heading })
        for (const image of Array.from(document.querySelectorAll('img'))) {
          const element = image as { getAttribute(name: string): string | null }
          blocks.push({
            type: 'image',
            source: element.getAttribute('src') ?? '',
            text: element.getAttribute('alt') ?? ''
          })
        }
        return { blocks, warnings: [] }
      } finally {
        dom.window.close()
      }
    })
  }
})

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

const COMMENT_PREFIXED_SVG = Buffer.from(
  '<!-- chart -->\n<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#ff0000"/></svg>',
  'utf8'
)

const roots: string[] = []

async function writeReport(imageName: string, image: Buffer): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'html-passthrough-'))
  roots.push(root)
  await writeFile(path.join(root, imageName), image)
  const filePath = path.join(root, 'report.html')
  await writeFile(
    filePath,
    `<!doctype html><html><head><title>Report</title></head><body><script>alert(1)</script><h1>Report</h1><img src="${imageName}" alt="Chart"></body></html>`
  )
  return filePath
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('prepared HTML image passthrough', () => {
  it.each(['html', 'pdf'] as const)(
    'returns sanitized %s without decoding an inlined image that would exceed the PNG cap',
    async (format) => {
      const filePath = await writeReport('chart.png', TINY_PNG)
      const toPdf = vi.spyOn(printService, 'toDocumentPdfBuffer')
      const result = await convertDocumentBundle({ filePath, format })
      const html = format === 'html' ? result.bytes.toString() : vi.mocked(HtmlModule.renderStaticHtml).mock.calls[1][0]

      expect(sharp).not.toHaveBeenCalled()
      expect(toPdf).not.toHaveBeenCalled()
      expect(html).toContain(`data:image/png;base64,${TINY_PNG.toString('base64')}`)
      expect(html).not.toContain('<script')
      expect(html).not.toContain('alert(1)')
      expect(result.warnings).toContain('scripts_omitted')
      if (format === 'pdf') {
        expect(result.bytes.toString()).toBe('%PDF')
        expect(HtmlModule.renderStaticHtml).toHaveBeenCalledTimes(2)
        expect(vi.mocked(HtmlModule.renderStaticHtml).mock.calls[1][1]).toBe(true)
      } else {
        expect(HtmlModule.renderStaticHtml).toHaveBeenCalledTimes(1)
        expect(vi.mocked(HtmlModule.renderStaticHtml).mock.calls[0][1]).toBe(false)
      }
    }
  )

  it.each(['md', 'docx'] as const)(
    'still applies the decoded PNG cap when %s output consumes extracted images',
    async (format) => {
      const filePath = await writeReport('chart.png', TINY_PNG)

      await expect(convertDocumentBundle({ filePath, format })).rejects.toMatchObject({
        code: 'CONVERSION_FAILED',
        message: 'Decoded image exceeds the 10 MB limit'
      })
      expect(sharp).toHaveBeenCalledTimes(1)
    }
  )

  it.each(['html', 'pdf'] as const)(
    'returns sanitized %s with the original SVG data URL when a leading comment would fail the signature check',
    async (format) => {
      const filePath = await writeReport('chart.svg', COMMENT_PREFIXED_SVG)
      const result = await convertDocumentBundle({ filePath, format })
      const html = format === 'html' ? result.bytes.toString() : vi.mocked(HtmlModule.renderStaticHtml).mock.calls[1][0]
      const embedded = `data:image/svg+xml;base64,${COMMENT_PREFIXED_SVG.toString('base64')}`

      expect(sharp).not.toHaveBeenCalled()
      expect(html).toContain(embedded)
      expect(html).not.toContain('<script')
      expect(result.warnings).toContain('scripts_omitted')
    }
  )

  it.each(['md', 'docx'] as const)('still rejects a comment-prefixed SVG for %s output', async (format) => {
    const filePath = await writeReport('chart.svg', COMMENT_PREFIXED_SVG)

    await expect(convertDocumentBundle({ filePath, format })).rejects.toMatchObject({ code: 'INVALID_IMAGE' })
    expect(sharp).not.toHaveBeenCalled()
  })

  it('still rejects an HTML image outside the source directory before producing HTML', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'html-passthrough-'))
    const outside = await mkdtemp(path.join(os.tmpdir(), 'html-passthrough-outside-'))
    roots.push(root, outside)
    await writeFile(path.join(outside, 'secret.png'), TINY_PNG)
    const filePath = path.join(root, 'report.html')
    await writeFile(
      filePath,
      `<!doctype html><html><body><h1>Report</h1><img src="../${path.basename(outside)}/secret.png" alt="Secret"></body></html>`
    )

    await expect(convertDocumentBundle({ filePath, format: 'html' })).rejects.toMatchObject({
      code: 'RESOURCE_UNAVAILABLE'
    })
    expect(sharp).not.toHaveBeenCalled()
    expect(HtmlModule.renderStaticHtml).not.toHaveBeenCalled()
  })

  it('still aborts prepared HTML conversion before reading images', async () => {
    const filePath = await writeReport('chart.png', TINY_PNG)
    const controller = new AbortController()
    controller.abort()

    await expect(convertDocumentBundle({ filePath, format: 'pdf' }, controller.signal)).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(sharp).not.toHaveBeenCalled()
    expect(HtmlModule.renderStaticHtml).not.toHaveBeenCalled()
  })
})
