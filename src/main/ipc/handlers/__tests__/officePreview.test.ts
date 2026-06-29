import { IpcError } from '@shared/ipc/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cancelMock, renderMock } = vi.hoisted(() => ({
  cancelMock: vi.fn(),
  renderMock: vi.fn()
}))

vi.mock('@main/services/officePreview', () => ({
  officePreviewService: {
    cancel: cancelMock,
    render: renderMock
  }
}))

import { officePreviewHandlers } from '../officePreview'

const input = {
  workspacePath: '/tmp/workspace',
  filePath: 'report.docx',
  requestId: 'preview-1'
}

const cancelInput = {
  requestId: 'preview-1'
}

describe('officePreviewHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects calls from unmanaged senders before touching the file system', async () => {
    await expect(officePreviewHandlers['office_preview.render'](input, { senderId: null })).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_INVALID_REQUEST'
    })
    expect(renderMock).not.toHaveBeenCalled()
  })

  it('delegates managed window calls to the preview service', async () => {
    const output = { html: '<p>Hello</p>' }
    renderMock.mockResolvedValueOnce(output)

    await expect(officePreviewHandlers['office_preview.render'](input, { senderId: 'w1' })).resolves.toBe(output)
    expect(renderMock).toHaveBeenCalledWith(input, 'w1')
  })

  it('delegates cancel requests to the preview service with sender scope', async () => {
    cancelMock.mockReturnValueOnce({ cancelled: true })

    await expect(officePreviewHandlers['office_preview.cancel'](cancelInput, { senderId: 'w1' })).resolves.toEqual({
      cancelled: true
    })
    expect(cancelMock).toHaveBeenCalledWith('preview-1', 'w1')
  })

  it('rejects cancel calls from unmanaged senders', async () => {
    await expect(officePreviewHandlers['office_preview.cancel'](cancelInput, { senderId: null })).rejects.toMatchObject(
      {
        code: 'OFFICE_PREVIEW_INVALID_REQUEST'
      }
    )
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it('throws IpcError for unmanaged senders', async () => {
    await expect(officePreviewHandlers['office_preview.render'](input, { senderId: null })).rejects.toBeInstanceOf(
      IpcError
    )
  })
})
