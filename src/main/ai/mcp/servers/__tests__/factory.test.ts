import { describe, expect, it, vi } from 'vitest'

import type { McpServer } from '@shared/data/types/mcpServer'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({})
})

const { createInMemoryMcpServer, getBuiltinAutoInstallEnv, getBuiltinHttpHeaders } = await import('../factory')

const server = (overrides: Partial<McpServer>): McpServer => ({
  id: 'id',
  name: 'custom',
  type: 'stdio',
  isActive: true,
  ...overrides
})

describe('getBuiltinAutoInstallEnv', () => {
  const autoInstall = {
    name: BuiltinMcpServerNames.mcpAutoInstall,
    command: 'npx',
    installSource: 'builtin' as const
  }
  const cherryOwnedPaths = {
    MCP_REGISTRY_PATH: '/mock/feature.mcp.registry_file',
    MCP_SETTINGS_PATH: '/mock/feature.mcp.auto_install_settings_file'
  }

  it('keeps the cache and config writes inside the Cherry tree whether or not an npm mirror is set', () => {
    expect(getBuiltinAutoInstallEnv(server(autoInstall))).toEqual(cherryOwnedPaths)
    expect(getBuiltinAutoInstallEnv(server({ ...autoInstall, registryUrl: 'https://npm.example' }))).toEqual(
      cherryOwnedPaths
    )
  })

  it('leaves every other server alone', () => {
    const other = server({ name: 'my-server', command: 'node' })
    const collision = server({ name: BuiltinMcpServerNames.mcpAutoInstall, installSource: 'manual', command: 'npx' })
    const prefix = server({
      name: `${BuiltinMcpServerNames.mcpAutoInstall}-custom`,
      installSource: 'builtin',
      command: 'npx'
    })

    expect(getBuiltinAutoInstallEnv(other)).toEqual({})
    expect(getBuiltinAutoInstallEnv(collision)).toEqual({})
    expect(getBuiltinAutoInstallEnv(prefix)).toEqual({})
  })
})

describe('getBuiltinHttpHeaders', () => {
  const qveris = (apiKey?: string) =>
    server({
      name: BuiltinMcpServerNames.qveris,
      type: 'streamableHttp',
      installSource: 'builtin',
      env: { QVERIS_API_KEY: apiKey ?? '' }
    })

  it('authenticates QVeris with the API key the user configured', () => {
    expect(getBuiltinHttpHeaders(qveris('secret'))).toEqual({ Authorization: 'Bearer secret' })
  })

  it('fails activation instead of connecting QVeris anonymously', () => {
    expect(() => getBuiltinHttpHeaders(qveris())).toThrow(/QVERIS_API_KEY/)
    expect(() => getBuiltinHttpHeaders(qveris('   '))).toThrow(/QVERIS_API_KEY/)
  })

  it('adds nothing for any other server', () => {
    expect(getBuiltinHttpHeaders(server({ name: BuiltinMcpServerNames.flomo, type: 'streamableHttp' }))).toEqual({})
    expect(
      getBuiltinHttpHeaders(
        server({ name: BuiltinMcpServerNames.qveris, type: 'streamableHttp', installSource: 'manual' })
      )
    ).toEqual({})
  })
})

describe('createInMemoryMcpServer', () => {
  it('rejects a name with no in-process implementation', async () => {
    await expect(createInMemoryMcpServer(BuiltinMcpServerNames.mcpAutoInstall)).rejects.toThrow(
      /Unknown in-memory MCP server/
    )
  })
})
