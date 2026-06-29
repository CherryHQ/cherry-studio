import { IpcError } from '@shared/ipc/errors'
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

    expect(result.html).toContain('Content-Security-Policy')
    expect(result.html).toContain('<p>Hello</p>')
    expect(mocks.convert).toHaveBeenCalledWith('/tmp/workspace/report.docx', 'html', expect.any(Object))
  })

  it('falls back to escaped text when HTML conversion returns empty output', async () => {
    mocks.convert
      .mockResolvedValueOnce({ value: '  ', messages: [] })
      .mockResolvedValueOnce({ value: 'plain <text>', messages: [] })

    const result = await officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'report.docx' })

    expect(result).toMatchObject({
      html: expect.stringContaining('<pre class="office-preview-text-fallback">plain &lt;text&gt;</pre>')
    })
    expect(mocks.convert).toHaveBeenNthCalledWith(2, '/tmp/workspace/report.docx', 'text', expect.any(Object))
  })

  it('uses the standalone HTML generator without remote chart scripts', async () => {
    mocks.convert.mockResolvedValueOnce({
      value: '<!DOCTYPE html><html><body><div class="spreadsheet-tabs"></div></body></html>',
      messages: []
    })

    await officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'report.xlsx' })

    const config = mocks.convert.mock.calls[0][2]
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
    mocks.convert.mockResolvedValueOnce({
      value:
        '<!DOCTYPE html><html><head><script src="https://cdn.jsdelivr.net/npm/chart.js"></script></head><body><a href="javascript:alert(1)" onclick="alert(2)">link</a></body></html>',
      messages: []
    })

    const result = await officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'report.docx' })

    expect(result.html).toContain('Content-Security-Policy')
    expect(result.html).not.toContain('cdn.jsdelivr.net')
    expect(result.html).not.toContain('javascript:alert')
    expect(result.html).not.toContain('onclick=')
  })

  it('rejects unsupported extensions before touching the file system', async () => {
    await expect(
      officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'report.xlsm' })
    ).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_UNSUPPORTED_EXTENSION'
    })
    expect(mocks.realpath).not.toHaveBeenCalled()
    expect(mocks.stat).not.toHaveBeenCalled()
    expect(mocks.convert).not.toHaveBeenCalled()
  })

  it('rejects absolute file paths from renderer input', async () => {
    await expect(
      officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: '/tmp/report.docx' })
    ).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_INVALID_REQUEST'
    })
    expect(mocks.realpath).not.toHaveBeenCalled()
  })

  it('rejects workspace paths that are not registered agent workspaces', async () => {
    mocks.listWorkspaces.mockResolvedValueOnce([{ path: '/tmp/workspace' }])

    await expect(
      officePreviewService.render({ workspacePath: '/', filePath: 'tmp/report.docx' })
    ).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_INVALID_REQUEST'
    })
    expect(mocks.realpath).not.toHaveBeenCalled()
    expect(mocks.convert).not.toHaveBeenCalled()
  })

  it('rejects symlinks that resolve outside the workspace', async () => {
    mocks.realpath.mockImplementation(async (input: string) => {
      if (input === '/tmp/workspace') return '/tmp/workspace'
      if (input === '/tmp/workspace/report.docx') return '/tmp/other/report.docx'
      return input
    })

    await expect(
      officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'report.docx' })
    ).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_INVALID_REQUEST'
    })
    expect(mocks.stat).not.toHaveBeenCalled()
    expect(mocks.convert).not.toHaveBeenCalled()
  })

  it('returns file_too_large before conversion', async () => {
    mocks.stat.mockResolvedValueOnce({
      isFile: () => true,
      size: 21 * 1024 * 1024
    })

    await expect(
      officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'report.docx' })
    ).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_FILE_TOO_LARGE'
    })
    expect(mocks.convert).not.toHaveBeenCalled()
  })

  it('returns file_too_large when generated HTML is too large for IPC preview', async () => {
    mocks.convert.mockResolvedValueOnce({
      value: 'x'.repeat(6 * 1024 * 1024),
      messages: []
    })

    await expect(
      officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'report.docx' })
    ).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_FILE_TOO_LARGE'
    })
  })

  it('maps conversion failures to parse_failed', async () => {
    mocks.convert.mockRejectedValueOnce(new Error('bad zip'))

    await expect(
      officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'report.docx' })
    ).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_PARSE_FAILED'
    })
    expect(mocks.loggerError).toHaveBeenCalledWith('Failed to render Office preview', expect.any(Error))
  })

  it('maps aborted conversion to parse_timeout', async () => {
    const error = new Error('The operation was aborted')
    error.name = 'AbortError'
    mocks.convert.mockRejectedValueOnce(error)

    await expect(
      officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'report.docx' })
    ).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_PARSE_TIMEOUT'
    })
  })

  it('renders xlsx previews through the Office HTML pipeline', async () => {
    mockFilePath('/tmp/workspace/report.xlsx')
    mocks.convert.mockResolvedValueOnce({
      value: '<table><tr><td>A1</td></tr></table>',
      messages: []
    })

    const result = await officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'report.xlsx' })

    expect(result.html).toContain('Content-Security-Policy')
    expect(result.html).toContain('<td>A1</td>')
  })

  it('throws IpcError instances for branchable domain failures', async () => {
    await expect(
      officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'report.xlsm' })
    ).rejects.toBeInstanceOf(IpcError)
  })
})
