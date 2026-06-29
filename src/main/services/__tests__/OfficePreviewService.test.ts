import { IpcError } from '@shared/ipc/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  realpath: vi.fn(),
  stat: vi.fn(),
  fork: vi.fn(),
  listWorkspaces: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn()
}))

vi.mock('node:fs/promises', () => ({
  realpath: mocks.realpath,
  stat: mocks.stat
}))

vi.mock('electron', () => ({
  utilityProcess: {
    fork: mocks.fork
  }
}))

vi.mock('../officePreview/officePreviewWorker?modulePath', () => ({
  default: '/mock/officePreviewWorker.js'
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

import { officePreviewService } from '../officePreview'

type ChildListener = (payload?: unknown) => void

function createUtilityChild() {
  const listeners = new Map<string, ChildListener[]>()
  const child = {
    on: vi.fn((event: string, listener: ChildListener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return child
    }),
    postMessage: vi.fn(),
    kill: vi.fn(() => true),
    emit: (event: string, payload?: unknown) => {
      for (const listener of listeners.get(event) ?? []) {
        listener(payload)
      }
    }
  }
  return child
}

function mockNextUtilityChild() {
  const child = createUtilityChild()
  mocks.fork.mockReturnValueOnce(child)
  return child
}

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
    vi.useRealTimers()
    vi.clearAllMocks()
    mockFilePath()
    mocks.listWorkspaces.mockResolvedValue([{ path: '/tmp/workspace' }])
  })

  it('renders supported Office files in a utility process', async () => {
    const child = mockNextUtilityChild()

    const resultPromise = officePreviewService.render(
      { workspacePath: '/tmp/workspace', filePath: 'report.docx', requestId: 'preview-1' },
      'w1'
    )

    await vi.waitFor(() => expect(mocks.fork).toHaveBeenCalled())
    expect(mocks.fork).toHaveBeenCalledWith(
      '/mock/officePreviewWorker.js',
      [],
      expect.objectContaining({
        serviceName: 'Cherry Studio Office Preview'
      })
    )
    expect(child.postMessage).toHaveBeenCalledWith({
      targetRealPath: '/tmp/workspace/report.docx',
      extension: 'docx'
    })

    child.emit('message', { ok: true, html: '<p>Hello</p>' })

    await expect(resultPromise).resolves.toEqual({ html: '<p>Hello</p>' })
    expect(child.kill).toHaveBeenCalled()
  })

  it('rejects unsupported extensions before touching the file system', async () => {
    await expect(
      officePreviewService.render(
        { workspacePath: '/tmp/workspace', filePath: 'report.xlsm', requestId: 'preview-1' },
        'w1'
      )
    ).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_UNSUPPORTED_EXTENSION'
    })
    expect(mocks.realpath).not.toHaveBeenCalled()
    expect(mocks.stat).not.toHaveBeenCalled()
    expect(mocks.fork).not.toHaveBeenCalled()
  })

  it('rejects absolute file paths from renderer input', async () => {
    await expect(
      officePreviewService.render(
        { workspacePath: '/tmp/workspace', filePath: '/tmp/report.docx', requestId: 'preview-1' },
        'w1'
      )
    ).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_INVALID_REQUEST'
    })
    expect(mocks.realpath).not.toHaveBeenCalled()
  })

  it('rejects workspace paths that are not registered agent workspaces', async () => {
    mocks.listWorkspaces.mockResolvedValueOnce([{ path: '/tmp/workspace' }])

    await expect(
      officePreviewService.render({ workspacePath: '/', filePath: 'tmp/report.docx', requestId: 'preview-1' }, 'w1')
    ).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_INVALID_REQUEST'
    })
    expect(mocks.realpath).not.toHaveBeenCalled()
    expect(mocks.fork).not.toHaveBeenCalled()
  })

  it('rejects symlinks that resolve outside the workspace', async () => {
    mocks.realpath.mockImplementation(async (input: string) => {
      if (input === '/tmp/workspace') return '/tmp/workspace'
      if (input === '/tmp/workspace/report.docx') return '/tmp/other/report.docx'
      return input
    })

    await expect(
      officePreviewService.render(
        { workspacePath: '/tmp/workspace', filePath: 'report.docx', requestId: 'preview-1' },
        'w1'
      )
    ).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_INVALID_REQUEST'
    })
    expect(mocks.stat).not.toHaveBeenCalled()
    expect(mocks.fork).not.toHaveBeenCalled()
  })

  it('returns file_too_large before starting the utility process', async () => {
    mocks.stat.mockResolvedValueOnce({
      isFile: () => true,
      size: 21 * 1024 * 1024
    })

    await expect(
      officePreviewService.render(
        { workspacePath: '/tmp/workspace', filePath: 'report.docx', requestId: 'preview-1' },
        'w1'
      )
    ).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_FILE_TOO_LARGE'
    })
    expect(mocks.fork).not.toHaveBeenCalled()
  })

  it('maps worker domain failures to IpcError instances', async () => {
    const child = mockNextUtilityChild()

    const resultPromise = officePreviewService.render(
      { workspacePath: '/tmp/workspace', filePath: 'report.docx', requestId: 'preview-1' },
      'w1'
    )

    await vi.waitFor(() => expect(mocks.fork).toHaveBeenCalled())
    child.emit('message', { ok: false, code: 'OFFICE_PREVIEW_FILE_TOO_LARGE' })

    await expect(resultPromise).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_FILE_TOO_LARGE'
    })
    await expect(resultPromise).rejects.toBeInstanceOf(IpcError)
  })

  it('maps worker crashes to parse_failed', async () => {
    const child = mockNextUtilityChild()

    const resultPromise = officePreviewService.render(
      { workspacePath: '/tmp/workspace', filePath: 'report.docx', requestId: 'preview-1' },
      'w1'
    )

    await vi.waitFor(() => expect(mocks.fork).toHaveBeenCalled())
    child.emit('exit', 1)

    await expect(resultPromise).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_PARSE_FAILED'
    })
  })

  it('kills the utility process and rejects the render when cancelled', async () => {
    const child = mockNextUtilityChild()

    const resultPromise = officePreviewService.render(
      { workspacePath: '/tmp/workspace', filePath: 'report.docx', requestId: 'preview-1' },
      'w1'
    )

    await vi.waitFor(() => expect(mocks.fork).toHaveBeenCalled())

    expect(officePreviewService.cancel('preview-1', 'w1')).toEqual({ cancelled: true })
    await expect(resultPromise).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_CANCELLED'
    })
    expect(child.kill).toHaveBeenCalled()
  })

  it('kills the utility process and maps timeouts to parse_timeout', async () => {
    vi.useFakeTimers()
    const child = mockNextUtilityChild()

    const resultPromise = officePreviewService.render(
      { workspacePath: '/tmp/workspace', filePath: 'report.docx', requestId: 'preview-1' },
      'w1'
    )

    await vi.waitFor(() => expect(mocks.fork).toHaveBeenCalled())
    const timeoutExpectation = expect(resultPromise).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_PARSE_TIMEOUT'
    })
    await vi.advanceTimersByTimeAsync(15_000)

    await timeoutExpectation
    expect(child.kill).toHaveBeenCalled()
  })

  it('does not cancel another sender scope with the same request id', async () => {
    const child = mockNextUtilityChild()

    const resultPromise = officePreviewService.render(
      { workspacePath: '/tmp/workspace', filePath: 'report.docx', requestId: 'preview-1' },
      'w1'
    )

    await vi.waitFor(() => expect(mocks.fork).toHaveBeenCalled())
    expect(officePreviewService.cancel('preview-1', 'w2')).toEqual({ cancelled: false })

    child.emit('message', { ok: true, html: '<p>Hello</p>' })

    await expect(resultPromise).resolves.toEqual({ html: '<p>Hello</p>' })
  })
})
