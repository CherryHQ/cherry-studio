import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { HOME_CHERRY_DIR } from '@shared/config/constant'
import { afterEach, describe, expect, it, vi } from 'vitest'

const createLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
})

async function loadCodeToolsService({ isMac = false, isWin = false } = {}) {
  vi.resetModules()

  vi.doMock('@logger', () => ({
    loggerService: {
      withContext: () => createLogger()
    }
  }))

  vi.doMock('@main/constant', () => ({
    isMac,
    isWin
  }))

  vi.doMock('@main/utils/process', () => ({
    findCommandInShellEnv: vi.fn(),
    getBinaryName: vi.fn(async (name: string) => name),
    getBinaryPath: vi.fn(),
    isBinaryExists: vi.fn()
  }))

  vi.doMock('@main/utils/shell-env', () => ({
    default: vi.fn(async () => ({}))
  }))

  vi.doMock('@main/utils/ipService', () => ({
    isUserInChina: vi.fn(async () => false)
  }))

  const mod = await import('../CodeToolsService')
  return mod.codeToolsService
}

describe('CodeToolsService - OpenCode command resolution', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('uses the global opencode shim on non-Windows even if package-local opencode.exe exists', async () => {
    const service = await loadCodeToolsService()
    const globalInstallDir = path.join(os.homedir(), HOME_CHERRY_DIR, 'install', 'global')
    const packageLocalExecutablePath = path.join(globalInstallDir, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe')
    const globalExecutablePath = path.join(os.homedir(), HOME_CHERRY_DIR, 'bin', 'opencode')

    vi.spyOn(fs, 'existsSync').mockImplementation((targetPath) => {
      const normalizedPath = String(targetPath)
      return normalizedPath === packageLocalExecutablePath || normalizedPath === globalExecutablePath
    })

    const command = await (service as any).getOpenCodeCommand()

    expect(command).toBe(`"${globalExecutablePath}"`)
  })
})
