import { describe, expect, it, vi } from 'vitest'

import type { McpServer } from '@shared/data/types/mcpServer'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({} as Record<string, unknown>)
})

const { createInMemoryMcpServer, getBuiltinHttpHeaders, getBuiltinRegistryEnv } = await import('../factory')

const server = (overrides: Partial<McpServer>): McpServer =>
  ({ id: 'id', name: 'custom', type: 'stdio', isActive: true, ...overrides }) as McpServer

describe('getBuiltinRegistryEnv', () => {
  it('points mcp-auto-install at the registered catalog path when a registry is configured', () => {
    const autoInstall = {
      name: BuiltinMcpServerNames.mcpAutoInstall,
      command: 'npx',
      installSource: 'builtin' as const
    }

    expect(getBuiltinRegistryEnv(server({ ...autoInstall, registryUrl: 'https://npm.example' }))).toEqual({
      MCP_REGISTRY_PATH: '/mock/feature.mcp.registry_file'
    })
    expect(getBuiltinRegistryEnv(server(autoInstall))).toEqual({})
  })

  it('leaves every other server alone', () => {
    const other = server({ name: 'my-server', command: 'node', registryUrl: 'https://npm.example' })
    const collision = server({
      name: BuiltinMcpServerNames.mcpAutoInstall,
      installSource: 'manual',
      command: 'npx',
      registryUrl: 'https://npm.example'
    })
    const prefix = server({
      name: `${BuiltinMcpServerNames.mcpAutoInstall}-custom`,
      installSource: 'builtin',
      command: 'npx',
      registryUrl: 'https://npm.example'
    })

    expect(getBuiltinRegistryEnv(other)).toEqual({})
    expect(getBuiltinRegistryEnv(collision)).toEqual({})
    expect(getBuiltinRegistryEnv(prefix)).toEqual({})
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
