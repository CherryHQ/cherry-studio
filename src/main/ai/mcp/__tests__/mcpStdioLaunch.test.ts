import { describe, expect, it, vi } from 'vitest'

import { loggerService } from '@logger'
import type { McpServer } from '@shared/data/types/mcpServer'

const packages = vi.hoisted(() => ({ isReady: true, getResolvedMcpConfig: vi.fn() }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const overrides: Record<string, unknown> = { McpPackageService: packages }
  return mockApplicationFactory(overrides)
})
vi.mock('@main/utils/shellEnv', () => ({ getShellEnv: async () => ({ PATH: '/fixture/bin' }) }))
vi.mock('@main/utils/commandResolver', () => ({
  findCommandInShellEnv: async () => '/fixture/bin/server'
}))

const { resolveStdioLaunch } = await import('../mcpStdioLaunch')

describe('resolveStdioLaunch', () => {
  it('preserves own package environment keys and overrides without mutating either configuration', async () => {
    const configuredEnv = Object.freeze({ SHARED: 'configured', CONFIGURED: 'kept' })
    const packageEnv = Object.freeze({ ['__proto__']: 'package-value', SHARED: 'package' })
    packages.getResolvedMcpConfig.mockReturnValue({
      command: 'fixture-server',
      args: ['--stdio'],
      env: packageEnv
    })
    const server: McpServer = {
      id: 'fixture',
      name: 'fixture',
      type: 'stdio',
      isActive: true,
      command: 'configured-server',
      dxtPath: '/fixture/package',
      env: configuredEnv
    }

    const result = await resolveStdioLaunch({
      server,
      args: [],
      logger: loggerService.withContext('StdioLaunchTest')
    })

    expect(Object.hasOwn(result.serverEnv, '__proto__')).toBe(true)
    expect(result.serverEnv.__proto__).toBe('package-value')
    expect(result.serverEnv.SHARED).toBe('package')
    expect(result.serverEnv.CONFIGURED).toBe('kept')
    expect(Object.getPrototypeOf(result.serverEnv)).toBe(Object.prototype)
    expect(configuredEnv).toEqual({ SHARED: 'configured', CONFIGURED: 'kept' })
    expect(packageEnv).toEqual({ ['__proto__']: 'package-value', SHARED: 'package' })
    expect(result.launch).toMatchObject({ command: '/fixture/bin/server', args: ['--stdio'], resolution: 'system' })
  })
})
