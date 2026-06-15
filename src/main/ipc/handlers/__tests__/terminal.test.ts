import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  autoDiscoverGitBashMock,
  configGetMock,
  configSetMock,
  getGitBashPathInfoMock,
  loggerErrorMock,
  loggerInfoMock,
  loggerWarnMock,
  platformState,
  validateGitBashPathMock
} = vi.hoisted(() => ({
  autoDiscoverGitBashMock: vi.fn(),
  configGetMock: vi.fn(),
  configSetMock: vi.fn(),
  getGitBashPathInfoMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  platformState: { isWin: false },
  validateGitBashPathMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: loggerErrorMock, info: loggerInfoMock, warn: loggerWarnMock })
  }
}))
vi.mock('@main/core/platform', () => ({
  get isWin() {
    return platformState.isWin
  }
}))
vi.mock('@main/services/ConfigManager', () => ({
  ConfigKeys: {
    GitBashPath: 'gitBashPath',
    GitBashPathSource: 'gitBashPathSource'
  },
  configManager: {
    get: configGetMock,
    set: configSetMock
  }
}))
vi.mock('@main/utils/process', () => ({
  autoDiscoverGitBash: autoDiscoverGitBashMock,
  getGitBashPathInfo: getGitBashPathInfoMock,
  validateGitBashPath: validateGitBashPathMock
}))

import { terminalHandlers } from '../terminal'

const ctx = (senderId: string | null) => ({ senderId })

beforeEach(() => {
  vi.clearAllMocks()
  platformState.isWin = false
  getGitBashPathInfoMock.mockReturnValue({ path: null, source: null })
  validateGitBashPathMock.mockReturnValue(null)
})

describe('terminalHandlers', () => {
  it('check_git_bash returns true on non-Windows without probing Git Bash', async () => {
    expect(await terminalHandlers['terminal.check_git_bash'](undefined, ctx('w1'))).toBe(true)
    expect(autoDiscoverGitBashMock).not.toHaveBeenCalled()
  })

  it('check_git_bash returns true on Windows when auto-discovery finds a path', async () => {
    platformState.isWin = true
    autoDiscoverGitBashMock.mockReturnValue('C:\\Git\\bin\\bash.exe')

    expect(await terminalHandlers['terminal.check_git_bash'](undefined, ctx('w1'))).toBe(true)
    expect(loggerInfoMock).toHaveBeenCalledWith('Git Bash is available', { path: 'C:\\Git\\bin\\bash.exe' })
  })

  it('check_git_bash returns false on Windows when auto-discovery fails', async () => {
    platformState.isWin = true
    autoDiscoverGitBashMock.mockReturnValue(null)

    expect(await terminalHandlers['terminal.check_git_bash'](undefined, ctx('w1'))).toBe(false)
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Git Bash not found. Please install Git for Windows from https://git-scm.com/downloads/win'
    )
  })

  it('check_git_bash returns false when probing throws', async () => {
    platformState.isWin = true
    const error = new Error('boom')
    autoDiscoverGitBashMock.mockImplementation(() => {
      throw error
    })

    expect(await terminalHandlers['terminal.check_git_bash'](undefined, ctx('w1'))).toBe(false)
    expect(loggerErrorMock).toHaveBeenCalledWith('Unexpected error checking Git Bash', error)
  })

  it('get_git_bash_path returns null on non-Windows', async () => {
    expect(await terminalHandlers['terminal.get_git_bash_path'](undefined, ctx('w1'))).toBeNull()
    expect(configGetMock).not.toHaveBeenCalled()
  })

  it('get_git_bash_path reads the configured path on Windows', async () => {
    platformState.isWin = true
    configGetMock.mockReturnValue('C:\\Git\\bin\\bash.exe')

    expect(await terminalHandlers['terminal.get_git_bash_path'](undefined, ctx('w1'))).toBe('C:\\Git\\bin\\bash.exe')
    expect(configGetMock).toHaveBeenCalledWith('gitBashPath')
  })

  it('get_git_bash_path_info delegates to the process helper', async () => {
    getGitBashPathInfoMock.mockReturnValue({ path: 'C:\\Git\\bin\\bash.exe', source: 'auto' })

    expect(await terminalHandlers['terminal.get_git_bash_path_info'](undefined, ctx('w1'))).toEqual({
      path: 'C:\\Git\\bin\\bash.exe',
      source: 'auto'
    })
  })

  it('set_git_bash_path returns false on non-Windows', async () => {
    expect(await terminalHandlers['terminal.set_git_bash_path']('C:\\Git\\bin\\bash.exe', ctx('w1'))).toBe(false)
    expect(configSetMock).not.toHaveBeenCalled()
  })

  it('set_git_bash_path clears the manual path and re-runs discovery for null input', async () => {
    platformState.isWin = true
    autoDiscoverGitBashMock.mockReturnValue('C:\\Git\\bin\\bash.exe')

    expect(await terminalHandlers['terminal.set_git_bash_path'](null, ctx('w1'))).toBe(true)
    expect(configSetMock).toHaveBeenCalledWith('gitBashPath', null)
    expect(configSetMock).toHaveBeenCalledWith('gitBashPathSource', null)
    expect(autoDiscoverGitBashMock).toHaveBeenCalledOnce()
  })

  it('set_git_bash_path rejects an invalid manual path', async () => {
    platformState.isWin = true
    validateGitBashPathMock.mockReturnValue(null)

    expect(await terminalHandlers['terminal.set_git_bash_path']('C:\\missing\\bash.exe', ctx('w1'))).toBe(false)
    expect(configSetMock).not.toHaveBeenCalled()
  })

  it('set_git_bash_path persists a validated manual path', async () => {
    platformState.isWin = true
    validateGitBashPathMock.mockReturnValue('C:\\Git\\bin\\bash.exe')

    expect(await terminalHandlers['terminal.set_git_bash_path']('C:\\Git\\bin\\bash.exe', ctx('w1'))).toBe(true)
    expect(configSetMock).toHaveBeenCalledWith('gitBashPath', 'C:\\Git\\bin\\bash.exe')
    expect(configSetMock).toHaveBeenCalledWith('gitBashPathSource', 'manual')
  })
})
