import type * as NodePath from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import type * as Platform from '@main/core/platform'

vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof NodePath>()
  return { ...actual.win32, default: actual.win32 }
})
vi.mock('@main/core/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof Platform>()),
  isWin: true,
  isMac: false
}))

import { evaluateWorkspaceInstallDirectoryPolicy as evaluate } from '../agentWorkspaceInstallDirectory'

const input = {
  workspacePath: 'D:\\Cherry Studio\\work',
  installDirectory: 'D:\\Cherry Studio',
  packaged: true,
  portableBuild: false
}

describe('workspace installation directory policy (Windows paths)', () => {
  it('allows unpackaged development even inside the installation directory', () => {
    expect(evaluate({ ...input, packaged: false })).toEqual({ allowed: true })
  })

  it('allows portable builds with colocated data', () => {
    expect(evaluate({ ...input, portableBuild: true })).toEqual({ allowed: true })
  })

  it.each([undefined, '', 'Cherry Studio'])(
    'allows an unavailable or nonabsolute installation directory: %s',
    (installDirectory) => {
      expect(evaluate({ ...input, installDirectory })).toEqual({ allowed: true })
    }
  )

  it.each([
    'D:\\Cherry Studio',
    'D:\\Cherry Studio\\work',
    'D:\\Cherry Studio\\work\\nested',
    'd:\\CHERRY STUDIO',
    'd:\\CHERRY STUDIO\\work',
    'D:\\Cherry Studio2\\..\\Cherry Studio\\work'
  ])('rejects the installation directory and descendants: %s', (workspacePath) => {
    expect(evaluate({ ...input, workspacePath })).toEqual({
      allowed: false,
      reason: 'install_directory',
      installDirectory: input.installDirectory
    })
  })

  it.each([
    ['D:\\Cherry Studio', '\\\\?\\D:\\Cherry Studio'],
    ['D:\\Cherry Studio', '\\\\?\\D:\\Cherry Studio\\work'],
    ['D:\\Cherry Studio', '\\\\.\\D:\\Cherry Studio'],
    ['D:\\Cherry Studio', '\\\\.\\D:\\Cherry Studio\\work'],
    ['\\\\srv\\share\\Cherry Studio', '\\\\?\\UNC\\srv\\share\\Cherry Studio'],
    ['\\\\srv\\share\\Cherry Studio', '\\\\?\\UNC\\srv\\share\\Cherry Studio\\work'],
    ['\\\\?\\D:\\Cherry Studio', 'D:\\Cherry Studio\\work'],
    ['\\\\.\\D:\\Cherry Studio', 'D:\\Cherry Studio\\work'],
    ['\\\\?\\UNC\\srv\\share\\Cherry Studio', '\\\\srv\\share\\Cherry Studio\\work']
  ])('rejects equivalent Windows namespaces: %s contains %s', (installDirectory, workspacePath) => {
    expect(evaluate({ ...input, installDirectory, workspacePath })).toEqual({
      allowed: false,
      reason: 'install_directory',
      installDirectory
    })
  })

  it.each([
    ['D:\\Cherry Studio', '\\\\?\\D:\\Cherry Studio2\\work'],
    ['D:\\Cherry Studio', '\\\\.\\E:\\Cherry Studio\\work'],
    ['\\\\srv\\share\\Cherry Studio', '\\\\?\\UNC\\srv\\share\\projects\\work']
  ])('allows outside Windows namespaces: %s excludes %s', (installDirectory, workspacePath) => {
    expect(evaluate({ ...input, installDirectory, workspacePath })).toEqual({ allowed: true })
  })

  it.each(['\\\\srv\\share\\Cherry Studio', '\\\\srv\\share\\Cherry Studio\\work'])(
    'rejects a UNC installation directory and descendants: %s',
    (workspacePath) => {
      const installDirectory = '\\\\srv\\share\\Cherry Studio'
      expect(evaluate({ ...input, installDirectory, workspacePath })).toEqual({
        allowed: false,
        reason: 'install_directory',
        installDirectory
      })
    }
  )

  it.each(['D:\\', 'D:\\work'])('rejects a drive-root installation and descendants: %s', (workspacePath) => {
    const installDirectory = 'D:\\'
    expect(evaluate({ ...input, installDirectory, workspacePath })).toEqual({
      allowed: false,
      reason: 'install_directory',
      installDirectory
    })
  })

  it('rejects descendants when the installation directory has a trailing separator', () => {
    const installDirectory = 'D:\\Cherry Studio\\'
    expect(evaluate({ ...input, installDirectory })).toEqual({
      allowed: false,
      reason: 'install_directory',
      installDirectory
    })
  })

  it.each(['D:\\Cherry Studio2', 'D:\\cherry studio2\\work', 'D:\\', 'E:\\Cherry Studio\\work'])(
    'allows siblings, ancestors, and other drives: %s',
    (workspacePath) => {
      expect(evaluate({ ...input, workspacePath })).toEqual({ allowed: true })
    }
  )
})
