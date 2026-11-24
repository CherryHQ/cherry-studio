import type os from 'node:os'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dialogMock, quitMock, getLocaleMock, osReleaseMock } = vi.hoisted(() => ({
  dialogMock: { showErrorBox: vi.fn() },
  quitMock: vi.fn(),
  getLocaleMock: vi.fn(() => 'en-US'),
  osReleaseMock: vi.fn(() => '10.0.19044')
}))

vi.mock('electron', () => ({
  app: { getLocale: getLocaleMock },
  dialog: dialogMock
}))

vi.mock('@application', () => ({
  application: { quit: quitMock }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
  }
}))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>()
  const mocked = { ...actual, release: osReleaseMock }
  return {
    ...mocked,
    default: mocked
  }
})

function setPlatform(value: string) {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

async function loadModule() {
  return import('../osSupportGate')
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  getLocaleMock.mockReturnValue('en-US')
  osReleaseMock.mockReturnValue('10.0.19044')
  setPlatform('win32')
})

describe('runOsSupportGate', () => {
  it('lets supported Windows builds through without dialogs', async () => {
    osReleaseMock.mockReturnValue('10.0.19044')
    const { runOsSupportGate } = await loadModule()
    expect(runOsSupportGate()).toBe('skipped')
    expect(dialogMock.showErrorBox).not.toHaveBeenCalled()
    expect(quitMock).not.toHaveBeenCalled()
  })

  it('lets Windows 11 builds through', async () => {
    osReleaseMock.mockReturnValue('10.0.22000')
    const { runOsSupportGate } = await loadModule()
    expect(runOsSupportGate()).toBe('skipped')
    expect(dialogMock.showErrorBox).not.toHaveBeenCalled()
  })

  it('blocks Windows 7 before any user-data work', async () => {
    osReleaseMock.mockReturnValue('6.1.7601')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as unknown as never)
    try {
      const { runOsSupportGate } = await loadModule()
      expect(runOsSupportGate()).toBe('handled')
      expect(dialogMock.showErrorBox).toHaveBeenCalledOnce()
      expect(quitMock).toHaveBeenCalledOnce()
      expect(exitSpy).toHaveBeenCalledWith(1)
      const [, message] = dialogMock.showErrorBox.mock.calls[0] as [string, string]
      expect(message).toContain('6.1.7601')
      expect(message).toContain('github.com/CherryHQ/cherry-studio/releases')
    } finally {
      exitSpy.mockRestore()
    }
  })

  it('blocks Windows 8.1', async () => {
    osReleaseMock.mockReturnValue('6.3.9600')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as unknown as never)
    try {
      const { runOsSupportGate } = await loadModule()
      expect(runOsSupportGate()).toBe('handled')
    } finally {
      exitSpy.mockRestore()
    }
  })

  it('skips non-Windows platforms without reading the OS release', async () => {
    setPlatform('darwin')
    const { runOsSupportGate } = await loadModule()
    expect(runOsSupportGate()).toBe('skipped')
    expect(osReleaseMock).not.toHaveBeenCalled()
    expect(dialogMock.showErrorBox).not.toHaveBeenCalled()
    setPlatform('win32')
  })
})
