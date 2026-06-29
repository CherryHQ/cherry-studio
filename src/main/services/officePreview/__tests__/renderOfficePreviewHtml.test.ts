import { beforeEach, describe, expect, it, vi } from 'vitest'

const { convertMock } = vi.hoisted(() => ({
  convertMock: vi.fn()
}))

vi.mock('officeparser', () => ({
  OfficeConverter: {
    convert: convertMock
  },
  OfficeErrorType: {
    OPERATION_ABORTED: 'OPERATION_ABORTED'
  }
}))

import { renderOfficePreviewHtml } from '../renderOfficePreviewHtml'

describe('renderOfficePreviewHtml', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders Office files to hardened HTML', async () => {
    convertMock.mockResolvedValueOnce({
      value: '<p>Hello</p>',
      messages: [{ code: 'notice', message: 'partial support' }]
    })

    const html = await renderOfficePreviewHtml('/tmp/workspace/report.docx', 'docx')

    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain('<p>Hello</p>')
    expect(convertMock).toHaveBeenCalledWith('/tmp/workspace/report.docx', 'html', expect.any(Object))
  })

  it('falls back to escaped text when HTML conversion returns empty output', async () => {
    convertMock
      .mockResolvedValueOnce({ value: '  ', messages: [] })
      .mockResolvedValueOnce({ value: 'plain <text>', messages: [] })

    await expect(renderOfficePreviewHtml('/tmp/workspace/report.docx', 'docx')).resolves.toContain(
      '<pre class="office-preview-text-fallback">plain &lt;text&gt;</pre>'
    )
    expect(convertMock).toHaveBeenNthCalledWith(2, '/tmp/workspace/report.docx', 'text', expect.any(Object))
  })

  it('uses the standalone HTML generator without remote chart scripts', async () => {
    convertMock.mockResolvedValueOnce({
      value: '<!DOCTYPE html><html><body><div class="spreadsheet-tabs"></div></body></html>',
      messages: []
    })

    await renderOfficePreviewHtml('/tmp/workspace/report.xlsx', 'xlsx')

    const config = convertMock.mock.calls[0][2]
    expect(config.generatorConfig).toMatchObject({
      includeFormatting: true,
      includeImages: true,
      includeCharts: false,
      htmlConfig: {
        standalone: true,
        containerWidth: '100%'
      }
    })
    expect(config.generatorConfig.htmlConfig.injections.headStart).toContain('Object.defineProperty(window')
    expect(config.generatorConfig.htmlConfig.injections.headStart).toContain('a.spreadsheet-tab[href^="#sheet-"]')
    expect(config.generatorConfig.htmlConfig.injections.headStart).toContain('event.preventDefault()')
    expect(config.parseConfig).not.toHaveProperty('extractAttachments', false)
    expect(config.parseConfig).not.toHaveProperty('ignoreNotes', true)
    expect(config.parseConfig).not.toHaveProperty('ignoreComments', true)
  })

  it('hardens generated HTML before returning it to the renderer', async () => {
    convertMock.mockResolvedValueOnce({
      value:
        '<!DOCTYPE html><html><head><script src="https://cdn.jsdelivr.net/npm/chart.js"></script></head><body><a href="javascript:alert(1)" onclick="alert(2)">link</a></body></html>',
      messages: []
    })

    const html = await renderOfficePreviewHtml('/tmp/workspace/report.docx', 'docx')

    expect(html).toContain('Content-Security-Policy')
    expect(html).not.toContain('cdn.jsdelivr.net')
    expect(html).not.toContain('javascript:alert')
    expect(html).not.toContain('onclick=')
  })

  it('returns file_too_large when generated HTML is too large for IPC preview', async () => {
    convertMock.mockResolvedValueOnce({
      value: 'x'.repeat(6 * 1024 * 1024),
      messages: []
    })

    await expect(renderOfficePreviewHtml('/tmp/workspace/report.docx', 'docx')).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_FILE_TOO_LARGE'
    })
  })

  it('maps conversion failures to parse_failed', async () => {
    convertMock.mockRejectedValueOnce(new Error('bad zip'))

    await expect(renderOfficePreviewHtml('/tmp/workspace/report.docx', 'docx')).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_PARSE_FAILED'
    })
  })

  it('maps aborted conversion to parse_timeout', async () => {
    const error = new Error('The operation was aborted')
    error.name = 'AbortError'
    convertMock.mockRejectedValueOnce(error)

    await expect(renderOfficePreviewHtml('/tmp/workspace/report.docx', 'docx')).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_PARSE_TIMEOUT'
    })
  })
})
