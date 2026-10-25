import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Activity } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { createMockWorkbookModel } from '../../../../../packages/file-preview/src/plugins/spreadsheet/mockModel'
import type {
  XlsxParseRequest,
  XlsxParseResponse
} from '../../../../../packages/file-preview/src/plugins/spreadsheet/renderModel'
import { FilePreview } from '../FilePreview'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
const originalWorker = globalThis.Worker

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
vi.unmock('@cherrystudio/ui')

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
    model.sheets[1].name = `Revision ${new Uint8Array(request.data)[0]}`
    queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: { id: request.id, ok: true, model } })))
  }
}

const filePath = AbsoluteFilePathSchema.parse('/tmp/workbook.xlsx')
const metadata = (revision: number) => ({
  kind: 'file' as const,
  type: 'other' as const,
  size: 1,
  createdAt: 1,
  modifiedAt: revision,
  mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
})
const readResult = (revision: number) => ({
  content: new Uint8Array([revision]),
  version: { size: 1, mtime: revision }
})

beforeEach(async () => {
  mocks.request.mockReset()
  await i18n.changeLanguage('en-US')
  vi.stubGlobal('Worker', WorkbookWorker)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(500)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(500)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  globalThis.Worker = originalWorker
})

describe('FilePreview workbook refresh', () => {
  it('preserves the grid and scroll when an obsolete read settles before the latest metadata', async () => {
    const obsoleteRead = Promise.withResolvers<ReturnType<typeof readResult>>()
    const latestMetadata = Promise.withResolvers<ReturnType<typeof metadata>>()
    const getMetadata = vi.fn().mockResolvedValueOnce(metadata(1)).mockResolvedValueOnce(metadata(2))
    getMetadata.mockImplementationOnce(() => latestMetadata.promise)
    const read = vi
      .fn()
      .mockResolvedValueOnce(readResult(1))
      .mockImplementationOnce(() => obsoleteRead.promise)
    read.mockResolvedValueOnce(readResult(3))
    mocks.request.mockImplementation((channel: string) => {
      if (channel === 'file.get_metadata') return getMetadata()
      if (channel === 'file.read') return read()
      throw new Error(`Unexpected IPC request: ${channel}`)
    })

    const view = render(<FilePreview filePath={filePath} />)
    const grid = await screen.findByRole('grid', { name: 'Sales' })
    fireEvent.scroll(grid, { target: { scrollTop: 600, scrollLeft: 240 } })

    view.rerender(<FilePreview filePath={filePath} refreshKey={1} />)
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    view.rerender(<FilePreview filePath={filePath} refreshKey={2} />)
    await waitFor(() => expect(getMetadata).toHaveBeenCalledTimes(3))

    // The obsolete read sees changed bytes while its replacement metadata is still pending.
    await act(async () => obsoleteRead.resolve(readResult(3)))
    expect(screen.getByRole('grid', { name: 'Sales' })).toBe(grid)
    expect(grid.scrollTop).toBe(600)
    expect(grid.scrollLeft).toBe(240)
    expect(screen.queryByText('Preview failed')).not.toBeInTheDocument()

    await act(async () => latestMetadata.resolve(metadata(3)))
    expect(await screen.findByRole('tab', { name: 'Revision 3' })).toBeInTheDocument()
    expect(screen.getByRole('grid', { name: 'Sales' })).toBe(grid)
    expect(grid.scrollTop).toBe(600)
    expect(grid.scrollLeft).toBe(240)
    expect(getMetadata).toHaveBeenCalledTimes(3)
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('still reports a changed file when the latest refresh read disagrees with its metadata', async () => {
    const getMetadata = vi.fn().mockResolvedValueOnce(metadata(1)).mockResolvedValueOnce(metadata(2))
    const read = vi.fn().mockResolvedValueOnce(readResult(1)).mockResolvedValueOnce(readResult(3))
    mocks.request.mockImplementation((channel: string) => {
      if (channel === 'file.get_metadata') return getMetadata()
      if (channel === 'file.read') return read()
      throw new Error(`Unexpected IPC request: ${channel}`)
    })
    const view = render(<FilePreview filePath={filePath} />)
    await screen.findByRole('grid', { name: 'Sales' })

    view.rerender(<FilePreview filePath={filePath} refreshKey={1} />)

    expect(await screen.findByText('Preview failed')).toBeInTheDocument()
    expect(screen.queryByRole('grid', { name: 'Sales' })).not.toBeInTheDocument()
  })

  it('waits for fresh metadata after Activity reconnects and stamps selections with that same request', async () => {
    const user = userEvent.setup()
    const reconnectedMetadata = Promise.withResolvers<ReturnType<typeof metadata>>()
    const getMetadata = vi
      .fn()
      .mockResolvedValueOnce(metadata(1))
      .mockImplementationOnce(() => reconnectedMetadata.promise)
    const read = vi.fn().mockResolvedValueOnce(readResult(1)).mockResolvedValueOnce(readResult(2))
    mocks.request.mockImplementation((channel: string) => {
      if (channel === 'file.get_metadata') return getMetadata()
      if (channel === 'file.read') return read()
      throw new Error(`Unexpected IPC request: ${channel}`)
    })
    const onSelectionReference = vi.fn()
    const preview = (visible: boolean) => (
      <Activity mode={visible ? 'visible' : 'hidden'}>
        <FilePreview filePath={filePath} onSelectionReference={onSelectionReference} />
      </Activity>
    )
    const view = render(preview(true))
    const grid = await screen.findByRole('grid', { name: 'Sales' })
    fireEvent.scroll(grid, { target: { scrollTop: 600, scrollLeft: 240 } })

    view.rerender(preview(false))
    view.rerender(preview(true))
    await waitFor(() => expect(getMetadata).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('grid', { name: 'Sales' })).toBe(grid)
    expect(grid.scrollTop).toBe(600)
    expect(grid.scrollLeft).toBe(240)
    expect(read).toHaveBeenCalledOnce()

    await act(async () => reconnectedMetadata.resolve(metadata(2)))
    expect(await screen.findByRole('tab', { name: 'Revision 2' })).toBeInTheDocument()
    expect(screen.getByRole('grid', { name: 'Sales' })).toBe(grid)
    expect(grid.scrollTop).toBe(600)
    expect(grid.scrollLeft).toBe(240)
    expect(getMetadata).toHaveBeenCalledTimes(2)
    expect(read).toHaveBeenCalledTimes(2)

    fireEvent.scroll(grid, { target: { scrollTop: 0, scrollLeft: 0 } })
    await user.click(await screen.findByRole('gridcell', { name: 'Quarter' }))
    await waitFor(() =>
      expect(onSelectionReference).toHaveBeenLastCalledWith({
        path: filePath,
        anchor: { format: 'xlsx', sheet: 'Sales', range: 'A2' },
        excerpt: 'Quarter',
        fileStamp: { size: 1, mtimeMs: 2 }
      })
    )
  })
})
