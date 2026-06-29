import { IpcError } from '@shared/ipc/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { renderMock } = vi.hoisted(() => ({
  renderMock: vi.fn()
}))

vi.mock('@main/services/OfficePreviewService', () => ({
  officePreviewService: {
    render: renderMock
  }
}))

import { officePreviewHandlers } from '../officePreview'

const input = {
  workspacePath: '/tmp/workspace',
  filePath: 'report.docx'
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
    expect(renderMock).toHaveBeenCalledWith(input)
  })

  it('throws IpcError for unmanaged senders', async () => {
    await expect(officePreviewHandlers['office_preview.render'](input, { senderId: null })).rejects.toBeInstanceOf(
      IpcError
    )
  })
})
