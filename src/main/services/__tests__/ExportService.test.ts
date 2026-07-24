import AdmZip from 'adm-zip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const atomicWriteFile = vi.hoisted(() =>
  vi.fn(async (target: string, data: Uint8Array) => {
    void target
    void data
  })
)

vi.mock('@main/utils/file', () => ({ atomicWriteFile }))

import { ExportService } from '../ExportService'

describe('ExportService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exports directly to a provided path through the atomic file writer', async () => {
    const service = new ExportService()

    await service.exportToWordPath('# Weekly report', '/tmp/report.docx')

    expect(atomicWriteFile).toHaveBeenCalledOnce()
    const [target, data] = atomicWriteFile.mock.calls[0]
    expect(target).toBe('/tmp/report.docx')
    expect(Buffer.from(data).subarray(0, 2).toString()).toBe('PK')
  })

  it('does not write a rendered document when the operation is canceled before the atomic write', async () => {
    const service = new ExportService()
    const controller = new AbortController()
    controller.abort()

    await expect(
      service.exportToWordPath('# Weekly report', '/tmp/report.docx', controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(atomicWriteFile).not.toHaveBeenCalled()
  })

  it('forwards cancellation to the atomic file writer', async () => {
    const service = new ExportService()
    const controller = new AbortController()

    await service.exportToWordPath('# Weekly report', '/tmp/report.docx', controller.signal)

    expect(atomicWriteFile).toHaveBeenCalledWith('/tmp/report.docx', expect.any(Uint8Array), {
      signal: controller.signal
    })
  })

  it('preserves image alt text when the image itself is omitted from the Word document', async () => {
    const service = new ExportService()

    await service.exportToWordPath(
      'Before ![Quarterly revenue chart](chart.png "Q2 revenue") after',
      '/tmp/report.docx'
    )

    const [, data] = atomicWriteFile.mock.calls[0]
    const archive = new AdmZip(Buffer.from(data))
    const documentXml = archive.readAsText('word/document.xml')

    expect(documentXml).toContain('Before ')
    expect(documentXml).toContain('Quarterly revenue chart')
    expect(documentXml).toContain(' after')
  })
})
