import type * as NodePath from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { buildPiLoginPathPrefix, mergePiShellExecutionEnv } from './piShell'

vi.mock('@main/core/platform', () => ({ isWin: true, isMac: false, isLinux: false, isDev: false, isPortable: false }))
vi.mock('path', async () => {
  const { win32 } = await vi.importActual<typeof NodePath>('node:path')
  return { ...win32, default: win32 }
})

describe('Pi Windows shell environment', () => {
  afterEach(() => vi.restoreAllMocks())

  beforeEach(() => {
    const original = vi.mocked(application.getPath).getMockImplementation()
    if (!original) throw new Error('The unified application mock must provide paths')
    vi.spyOn(application, 'getPath').mockImplementation((key, ...args) => {
      if (key === 'feature.binary.data') return 'C:\\Cherry\\binary'
      if (key === 'cherry.bin') return 'C:\\Cherry\\bin'
      return original(key, ...args)
    })
  })

  it('preserves PowerShell environment variables and combines Windows PATH casings', () => {
    const base = {
      Path: 'C:\\Program Files\\PowerShell\\7;C:\\Windows\\System32',
      PATH: 'c:\\windows\\system32;C:\\Tools',
      SystemRoot: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      PSModulePath: 'C:\\Program Files\\PowerShell\\Modules;C:\\User\\Modules',
      UNUSED: undefined
    }
    const env = mergePiShellExecutionEnv(base)
    expect(env).toMatchObject({ SystemRoot: base.SystemRoot, ComSpec: base.ComSpec, PSModulePath: base.PSModulePath })
    expect(Object.keys(env).filter((key) => key.toLowerCase() === 'path')).toEqual(['Path'])
    expect(env.Path.split(';')).toEqual([
      'C:\\Cherry\\binary\\shims',
      'C:\\Cherry\\bin',
      'C:\\Program Files\\PowerShell\\7',
      'C:\\Windows\\System32',
      'C:\\Tools'
    ])
    expect(env).not.toHaveProperty('UNUSED')
    expect(buildPiLoginPathPrefix('C:\\Tools', 'win32')).toBeUndefined()
  })

  it('preserves a caller-owned mise environment for PowerShell', () => {
    const env = mergePiShellExecutionEnv({
      Path: 'C:\\User\\mise\\shims;C:\\Cherry\\binary\\shims;C:\\Windows',
      MISE_DATA_DIR: 'C:\\User\\mise',
      MISE_SHELL: 'pwsh',
      PSModulePath: 'C:\\User\\Modules'
    })
    expect(env.Path.split(';')).toEqual(['C:\\User\\mise\\shims', 'C:\\Windows', 'C:\\Cherry\\bin'])
    expect(env).toMatchObject({
      MISE_DATA_DIR: 'C:\\User\\mise',
      MISE_SHELL: 'pwsh',
      PSModulePath: 'C:\\User\\Modules'
    })
  })
})
