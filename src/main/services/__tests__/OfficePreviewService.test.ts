import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  realpath: vi.fn(),
  stat: vi.fn(),
  convert: vi.fn(),
  listWorkspaces: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn()
}))

vi.mock('node:fs/promises', () => ({
  realpath: mocks.realpath,
  stat: mocks.stat
}))

vi.mock('officeparser', () => ({
  OfficeConverter: {
    convert: mocks.convert
  },
  OfficeErrorType: {
    OPERATION_ABORTED: 'OPERATION_ABORTED'
  }
}))

vi.mock('@data/services/AgentWorkspaceService', () => ({
  agentWorkspaceService: {
    list: mocks.listWorkspaces
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: mocks.loggerWarn,
      error: mocks.loggerError
    })
  }
}))

import { officePreviewService } from '../OfficePreviewService'

function mockFilePath(filePath = '/tmp/workspace/report.docx') {
  mocks.realpath.mockImplementation(async (input: string) => {
    if (input === '/tmp/workspace') return '/tmp/workspace'
    if (input === filePath) return filePath
    return input
  })
  mocks.stat.mockResolvedValue({
    isFile: () => true,
    size: 1024
  })
}

describe('OfficePreviewService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFilePath()
    mocks.listWorkspaces.mockResolvedValue([{ path: '/tmp/workspace' }])
  })

  it('renders supported Office files to HTML', async () => {
    mocks.convert.mockResolvedValueOnce({
      value: '<p>Hello</p>',
      messages: [{ code: 'notice', message: 'partial support' }]
    })

    const result = await officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'report.docx' })

    expect(result).toEqual({
      status: 'ready',
      extension: 'docx',
      type: 'html',
      html: '<p>Hello</p>'
    })
    expect(mocks.convert).toHaveBeenCalledWith('/tmp/workspace/report.docx', 'html', expect.any(Object))
  })

  it('falls back to escaped text when HTML conversion returns empty output', async () => {
    mocks.convert
      .mockResolvedValueOnce({ value: '  ', messages: [] })
      .mockResolvedValueOnce({ value: 'plain <text>', messages: [] })

    const result = await officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'report.docx' })

    expect(result).toMatchObject({
      status: 'ready',
      extension: 'docx',
      type: 'html',
      html: expect.stringContaining('<pre class="office-preview-text-fallback">plain &lt;text&gt;</pre>')
    })
    expect(mocks.convert).toHaveBeenNthCalledWith(2, '/tmp/workspace/report.docx', 'text', expect.any(Object))
  })

  it('uses the official standalone HTML generator with spreadsheet scripts available', async () => {
    mocks.convert.mockResolvedValueOnce({
      value: '<!DOCTYPE html><html><body><div class="spreadsheet-tabs"></div></body></html>',
      messages: []
    })

    await officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'report.xlsx' })

    const config = mocks.convert.mock.calls[0][2]
    expect(config.generatorConfig).toMatchObject({
      includeFormatting: true,
      includeImages: true,
      includeCharts: true,
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

  it('rejects unsupported extensions before touching the file system', async () => {
    const result = await officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'report.xlsm' })

    expect(result).toEqual({ status: 'error', code: 'unsupported_extension' })
    expect(mocks.realpath).not.toHaveBeenCalled()
    expect(mocks.stat).not.toHaveBeenCalled()
    expect(mocks.convert).not.toHaveBeenCalled()
  })

  it('rejects absolute file paths from renderer input', async () => {
    const result = await officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: '/tmp/report.docx' })

    expect(result).toEqual({ status: 'error', code: 'invalid_request', extension: 'docx', type: 'html' })
    expect(mocks.realpath).not.toHaveBeenCalled()
  })

  it('rejects workspace paths that are not registered agent workspaces', async () => {
    mocks.listWorkspaces.mockResolvedValueOnce([{ path: '/tmp/workspace' }])

    const result = await officePreviewService.render({ workspacePath: '/', filePath: 'tmp/report.docx' })

    expect(result).toEqual({ status: 'error', code: 'invalid_request', extension: 'docx', type: 'html' })
    expect(mocks.realpath).not.toHaveBeenCalled()
    expect(mocks.convert).not.toHaveBeenCalled()
  })

  it('rejects symlinks that resolve outside the workspace', async () => {
    mocks.realpath.mockImplementation(async (input: string) => {
      if (input === '/tmp/workspace') return '/tmp/workspace'
      if (input === '/tmp/workspace/report.docx') return '/tmp/other/report.docx'
      return input
    })

    const result = await officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'report.docx' })

    expect(result).toEqual({ status: 'error', code: 'invalid_request', extension: 'docx', type: 'html' })
    expect(mocks.stat).not.toHaveBeenCalled()
    expect(mocks.convert).not.toHaveBeenCalled()
  })

  it('returns file_too_large before conversion', async () => {
    mocks.stat.mockResolvedValueOnce({
      isFile: () => true,
      size: 21 * 1024 * 1024
    })

    const result = await officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'report.docx' })

    expect(result).toEqual({ status: 'error', code: 'file_too_large', extension: 'docx', type: 'html' })
    expect(mocks.convert).not.toHaveBeenCalled()
  })

  it('returns file_too_large when generated HTML is too large for IPC preview', async () => {
    mocks.convert.mockResolvedValueOnce({
      value: 'x'.repeat(6 * 1024 * 1024),
      messages: []
    })

    const result = await officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'report.docx' })

    expect(result).toEqual({ status: 'error', code: 'file_too_large', extension: 'docx', type: 'html' })
  })

  it('maps conversion failures to parse_failed', async () => {
    mocks.convert.mockRejectedValueOnce(new Error('bad zip'))

    const result = await officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'report.docx' })

    expect(result).toEqual({ status: 'error', code: 'parse_failed', extension: 'docx', type: 'html' })
    expect(mocks.loggerError).toHaveBeenCalledWith('Failed to render Office preview', expect.any(Error))
  })

  it('maps aborted conversion to parse_timeout', async () => {
    const error = new Error('The operation was aborted')
    error.name = 'AbortError'
    mocks.convert.mockRejectedValueOnce(error)

    const result = await officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'report.docx' })

    expect(result).toEqual({ status: 'error', code: 'parse_timeout', extension: 'docx', type: 'html' })
  })

  it('marks xlsx previews as excel', async () => {
    mockFilePath('/tmp/workspace/report.xlsx')
    mocks.convert.mockResolvedValueOnce({
      value: '<table><tr><td>A1</td></tr></table>',
      messages: []
    })

    const result = await officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'report.xlsx' })

    expect(result).toMatchObject({
      status: 'ready',
      extension: 'xlsx',
      type: 'excel',
      html: '<table><tr><td>A1</td></tr></table>'
    })
  })
})
