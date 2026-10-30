import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockWorkbookModel } from '../plugins/spreadsheet/mockModel'
import type { XlsxParseRequest, XlsxParseResponse } from '../plugins/spreadsheet/renderModel'
import { Preview } from '../Preview'
import { type PreviewDocument, PreviewError, type PreviewSource } from '../source'

class WorkbookWorker {
  onmessage: ((event: MessageEvent<XlsxParseResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminate = vi.fn()
  postMessage(request: XlsxParseRequest) {
    const model = createMockWorkbookModel()
    model.images = {}
    model.sheets.forEach((sheet) => {
      sheet.charts = []
      sheet.floatingImages = []
    })
    queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: { id: request.id, ok: true, model } })))
  }
}

beforeEach(() => {
  vi.stubGlobal('Worker', WorkbookWorker)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(500)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(500)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Preview workbook refresh', () => {
  it('keeps the real grid and its scroll when a closed read fails while the replacement source is still opening', async () => {
    const oldRead = Promise.withResolvers<Uint8Array<ArrayBuffer>>()
    const replacementOpen = Promise.withResolvers<PreviewDocument>()
    const readStarted = vi.fn()
    const makeDocument = (revision: string): PreviewDocument => ({
      size: 1,
      revision,
      readRange: async () => new Uint8Array([1]),
      close: vi.fn().mockResolvedValue(undefined)
    })
    const first = makeDocument('first')
    const obsolete = makeDocument('obsolete')
    obsolete.readRange = () => {
      readStarted()
      return oldRead.promise
    }
    const open = vi
      .fn<PreviewSource['open']>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(obsolete)
      .mockImplementationOnce(() => replacementOpen.promise)
    const source: PreviewSource = { id: 'workbook', name: 'workbook.xlsx', open }
    const onError = vi.fn()
    const view = render(<Preview source={source} onError={onError} />)
    const grid = await screen.findByTestId('xlsx-grid-scroll')
    fireEvent.scroll(grid, { target: { scrollTop: 600, scrollLeft: 240 } })

    view.rerender(<Preview source={source} refreshKey={1} onError={onError} />)
    await waitFor(() => expect(readStarted).toHaveBeenCalledOnce())
    view.rerender(<Preview source={source} refreshKey={2} onError={onError} />)
    await waitFor(() => expect(obsolete.close).toHaveBeenCalledOnce())
    // Settle the obsolete read before allowing the new open to complete.
    await act(async () => oldRead.reject(new PreviewError('closed', 'Document is closed')))
    expect(onError).not.toHaveBeenCalled()
    expect(screen.getByTestId('xlsx-grid-scroll')).toBe(grid)

    await act(async () => replacementOpen.resolve(makeDocument('replacement')))
    await waitFor(() => expect(view.container.querySelector('[inert]')).toBeNull())
    expect(screen.getByTestId('xlsx-grid-scroll')).toBe(grid)
    expect(grid.scrollTop).toBe(600)
    expect(grid.scrollLeft).toBe(240)
  })
})
