import type * as Fs from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CommandResolver from '@main/utils/commandResolver'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { normalizePiDisabledToolId } from '@shared/ai/piBuiltinTools'

import { buildPiShellRuntime, resolvePiShellSelection } from './piShell'

const mocks = vi.hoisted(() => ({ readFileSync: vi.fn(), discover: vi.fn(), validate: vi.fn() }))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof Fs>()),
  readFileSync: mocks.readFileSync
}))
vi.mock('@main/utils/commandResolver', async (importOriginal) => ({
  ...(await importOriginal<typeof CommandResolver>()),
  autoDiscoverGitBash: mocks.discover,
  validateGitBashPath: mocks.validate
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.readFileSync.mockImplementation(() => {
    throw new Error('missing')
  })
  mocks.discover.mockReturnValue(null)
})

describe('pi shell selection', () => {
  it('uses a validated explicit Git Bash path', () => {
    mocks.readFileSync.mockReturnValue(JSON.stringify({ shellPath: ' C:\\Git\\bash.exe ' }))
    mocks.validate.mockReturnValue('C:\\Git\\bash.exe')
    expect(resolvePiShellSelection('win32')).toEqual({ shell: 'bash', shellPath: 'C:\\Git\\bash.exe' })
    expect(mocks.discover).not.toHaveBeenCalled()
  })

  it('rejects an invalid configured path before discovery', () => {
    mocks.readFileSync.mockReturnValue(JSON.stringify({ shellPath: 'C:\\bad.exe' }))
    expect(() => resolvePiShellSelection('win32')).toThrowError(
      'Configured Pi shellPath is unavailable or is not bash.exe: C:\\bad.exe'
    )
    expect(mocks.discover).not.toHaveBeenCalled()
  })

  it('uses discovered Git Bash', () => {
    expect(resolvePiShellSelection('win32', 'C:\\Git\\bash.exe')).toEqual({
      shell: 'bash',
      shellPath: 'C:\\Git\\bash.exe'
    })
  })

  it('uses the discovery result and respects an explicit null', () => {
    mocks.discover.mockReturnValue('C:\\Git\\bash.exe')
    expect(resolvePiShellSelection('win32')).toEqual({ shell: 'bash', shellPath: 'C:\\Git\\bash.exe' })
    mocks.discover.mockClear()
    expect(resolvePiShellSelection('win32', null)).toEqual({ shell: 'powershell' })
    expect(mocks.discover).not.toHaveBeenCalled()
  })

  it('falls back to PowerShell when discovery fails', () => {
    expect(resolvePiShellSelection('win32')).toEqual({ shell: 'powershell' })
    expect(mocks.validate).not.toHaveBeenCalled()
  })

  it.each(['darwin', 'linux'] as const)('uses bash on %s', (platform) => {
    expect(resolvePiShellSelection(platform, null)).toEqual({ shell: 'bash' })
  })
})

describe('shell runtime and catalog', () => {
  it('exposes only PowerShell without bash settings', () => {
    expect(buildPiShellRuntime({ shell: 'powershell' }, 'prefix')).toEqual({
      builtinTools: ['read', 'powershell', 'edit', 'write'],
      mountManagedBash: false,
      settings: {}
    })
  })
  it('preserves bash settings', () => {
    expect(buildPiShellRuntime({ shell: 'bash', shellPath: 'C:\\Git\\bash.exe' }, 'prefix')).toEqual({
      builtinTools: ['read', 'bash', 'edit', 'write'],
      mountManagedBash: true,
      settings: { shellPath: 'C:\\Git\\bash.exe', shellCommandPrefix: 'prefix' }
    })
    expect(buildPiShellRuntime({ shell: 'bash' })).toEqual({
      builtinTools: ['read', 'bash', 'edit', 'write'],
      mountManagedBash: true,
      settings: {}
    })
  })
  it.each(['pi', 'pi-durable'] as const)('shows one shell capability in the %s catalog', (runtime) => {
    const tools = AGENT_RUNTIME_CAPABILITIES[runtime].builtinTools()
    const ids: string[] = tools.map((tool) => tool.id)
    expect(ids.filter((id) => id === 'bash' || id === 'powershell')).toEqual(['bash'])
    expect(normalizePiDisabledToolId('PowerShell')).toBe('powershell')
  })
})
