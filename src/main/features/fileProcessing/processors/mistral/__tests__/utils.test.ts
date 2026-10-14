import fs from 'node:fs/promises'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildMarkdownConversionResult, buildTextExtractionResult, uploadDocument } from '../utils'

describe('mistral utils', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('uploads documents for OCR purpose', async () => {
    const upload = vi.fn().mockResolvedValue({ id: 'file-1' })
    vi.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('pdf-data'))

    await expect(
      uploadDocument({
        file: {
          path: '/tmp/input.pdf',
          name: 'input',
          ext: 'pdf'
        },
        client: {
          files: {
            upload
          }
        }
      } as never)
    ).resolves.toBe('file-1')

    expect(upload).toHaveBeenCalledWith(
      {
        file: {
          fileName: 'input.pdf',
          content: new Uint8Array(Buffer.from('pdf-data'))
        },
        purpose: 'ocr'
      },
      {
        signal: undefined
      }
    )
  })

  it('combines page markdown into markdown conversion output', () => {
    expect(
      buildMarkdownConversionResult({
        model: 'mistral-ocr-latest',
        pages: [{ markdown: ' # Page 1 ' }, { markdown: '' }, { markdown: 'Page 2' }]
      } as never)
    ).toEqual({
      kind: 'markdown',
      markdownContent: '# Page 1\n\nPage 2'
    })
  })

  it('inlines separated tables at their placeholders with content copied verbatim', () => {
    expect(
      buildMarkdownConversionResult({
        model: 'mistral-ocr-latest',
        pages: [
          {
            markdown: '# Report\n\n[tbl-0.html](tbl-0.html)\n\nNotes\n\n[tbl-1.html](tbl-1.html)',
            tables: [
              { id: 'tbl-0.html', content: '<table><tr><td>42</td></tr></table>', format: 'html' },
              { id: 'tbl-1.html', content: "<table><tr><td>$&7 $' $$</td></tr></table>", format: 'html' }
            ]
          }
        ]
      } as never)
    ).toEqual({
      kind: 'markdown',
      markdownContent:
        "# Report\n\n<table><tr><td>42</td></tr></table>\n\nNotes\n\n<table><tr><td>$&7 $' $$</td></tr></table>"
    })
  })

  it('keeps table content when its placeholder is missing from the page markdown', () => {
    expect(
      buildMarkdownConversionResult({
        model: 'mistral-ocr-latest',
        pages: [
          {
            markdown: 'Body',
            tables: [{ id: 'tbl-0.html', content: '<table><tr><td>42</td></tr></table>', format: 'html' }]
          }
        ]
      } as never)
    ).toEqual({
      kind: 'markdown',
      markdownContent: 'Body\n\n<table><tr><td>42</td></tr></table>'
    })
  })

  it('inlines separated tables in text extraction output', () => {
    expect(
      buildTextExtractionResult({
        model: 'mistral-ocr-latest',
        pages: [
          {
            markdown: 'Body\n\n[tbl-0.html](tbl-0.html)',
            tables: [{ id: 'tbl-0.html', content: '<table><tr><td>42</td></tr></table>', format: 'html' }]
          }
        ]
      } as never)
    ).toEqual({
      kind: 'text',
      text: 'Body\n\n<table><tr><td>42</td></tr></table>'
    })
  })

  it('rejects empty markdown conversion output', () => {
    expect(() =>
      buildMarkdownConversionResult({
        model: 'mistral-ocr-latest',
        pages: [{ markdown: '  ' }]
      } as never)
    ).toThrow('Mistral OCR returned empty markdown content')
  })
})
