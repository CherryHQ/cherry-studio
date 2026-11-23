import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { XlsxParseRequest, XlsxParseResponse } from '../plugins/spreadsheet/renderModel'
import { Preview } from '../Preview'
import { type PreviewDocument, PreviewError } from '../source'
import type { PreviewResources } from '../types'

const parserError = vi.hoisted(() => new Error('Invalid PDF structure at xref offset 0'))

vi.mock('pdfjs-dist', () => ({
  AnnotationMode: { ENABLE: 1 },
  PDFDataRangeTransport: class {
    abort() {}
  },
  PDFWorker: { create: () => ({ destroy() {} }) },
  getDocument: () => ({ promise: Promise.reject(parserError), destroy: async () => {} })
}))
vi.mock('pdfjs-dist/web/pdf_viewer.css', () => ({}))
vi.mock('pdfjs-dist/web/pdf_viewer.mjs', () => ({ EventBus: class {}, PDFLinkService: class {}, PDFViewer: class {} }))
vi.unmock('@cherrystudio/ui')

afterEach(cleanup)

function openedDocument(): PreviewDocument {
  return {
    size: 4,
    revision: 'v1',
    readRange: async () => new Uint8Array([1, 2, 3, 4]),
    close: vi.fn().mockResolvedValue(undefined)
  }
}

const resources: PreviewResources = {
  readPdfResource: vi.fn(),
  createWorker: (kind) => {
    if (kind === 'pdf') return { terminate() {} } as Worker
    const worker = {
      onmessage: null as ((event: { data: XlsxParseResponse }) => void) | null,
      onerror: null,
      postMessage(request: XlsxParseRequest) {
        queueMicrotask(() => worker.onmessage?.({ data: { id: request.id, ok: false, message: 'Corrupt zip' } }))
      },
      terminate() {}
    }
    return worker as unknown as Worker
  }
}

describe('plugin parse failures after the source opens', () => {
  // Catches a plugin-rendered load error that drops the host's Details entry for a reported cause.
  it.each([
    ['malformed.pdf', parserError.message],
    ['malformed.xlsx', 'Corrupt zip']
  ])('offers the host error detail when %s fails to parse', async (name, cause) => {
    const onError = vi.fn()
    render(
      <Preview
        source={{ id: name, name, open: async () => openedDocument() }}
        resources={resources}
        onError={onError}
        errorDetail={<a href="#detail">Details</a>}
      />
    )

    expect(await screen.findByRole('heading', { name: 'Preview failed' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Details' })).toBeInTheDocument()
    const reported = onError.mock.calls[0][0] as PreviewError
    expect(onError).toHaveBeenCalledOnce()
    expect(reported).toBeInstanceOf(PreviewError)
    expect(reported.code).toBe('load_error')
    expect((reported.cause as Error).message).toBe(cause)
  })
})
