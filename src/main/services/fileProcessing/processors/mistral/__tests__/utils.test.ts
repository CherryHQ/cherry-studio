import fs from 'node:fs/promises'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildMarkdownConversionResult,
  deleteUploadedDocument,
  getUploadedDocumentSignedUrl,
  uploadDocument
} from '../utils'

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
          origin_name: 'input.pdf'
        },
        client: {
          files: {
            upload
          }
        }
      } as never)
    ).resolves.toBe('file-1')

    expect(fs.readFile).toHaveBeenCalledWith('/tmp/input.pdf')
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

  it('gets signed urls for uploaded documents', async () => {
    const getSignedUrl = vi.fn().mockResolvedValue({ url: 'https://signed.example.com/input.pdf' })

    await expect(
      getUploadedDocumentSignedUrl(
        {
          client: {
            files: {
              getSignedUrl
            }
          }
        } as never,
        'file-1'
      )
    ).resolves.toBe('https://signed.example.com/input.pdf')

    expect(getSignedUrl).toHaveBeenCalledWith(
      {
        fileId: 'file-1'
      },
      {
        signal: undefined
      }
    )
  })

  it('deletes uploaded documents', async () => {
    const deleteFile = vi.fn().mockResolvedValue({})

    await expect(
      deleteUploadedDocument(
        {
          client: {
            files: {
              delete: deleteFile
            }
          }
        } as never,
        'file-1'
      )
    ).resolves.toBeUndefined()

    expect(deleteFile).toHaveBeenCalledWith(
      {
        fileId: 'file-1'
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

  it('rejects empty markdown conversion output', () => {
    expect(() =>
      buildMarkdownConversionResult({
        model: 'mistral-ocr-latest',
        pages: [{ markdown: '  ' }]
      } as never)
    ).toThrow('Mistral OCR returned empty markdown content')
  })
})
