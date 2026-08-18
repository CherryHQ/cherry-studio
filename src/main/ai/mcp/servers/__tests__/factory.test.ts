import type { McpServer } from '@shared/data/types/mcpServer'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/binaryResolver', () => ({ getBinaryPath: async () => '/tmp/cherry/bin' }))
vi.mock('node:fs/promises', () => ({ default: { mkdir: async () => undefined } }))

const { createInMemoryMcpServer, getBuiltinHttpHeaders, getBuiltinRegistryEnv } = await import('../factory')

const server = (overrides: Partial<McpServer>): McpServer =>
  ({ id: 'id', name: 'custom', type: 'stdio', isActive: true, ...overrides }) as McpServer

describe('getBuiltinRegistryEnv', () => {
  it('points mcp-auto-install at the bundled registry file when a registry is configured', async () => {
    const autoInstall = { name: BuiltinMcpServerNames.mcpAutoInstall, command: 'npx' }

    expect(await getBuiltinRegistryEnv(server({ ...autoInstall, registryUrl: 'https://npm.example' }))).toEqual({
      MCP_REGISTRY_PATH: '/tmp/cherry/config/mcp-registry.json'
    })
    expect(await getBuiltinRegistryEnv(server(autoInstall))).toEqual({})
  })

  it('leaves every other server alone', async () => {
    const other = server({ name: 'my-server', command: 'node', registryUrl: 'https://npm.example' })

    expect(await getBuiltinRegistryEnv(other)).toEqual({})
  })
})

describe('getBuiltinHttpHeaders', () => {
  const qveris = (apiKey?: string) =>
    server({ name: BuiltinMcpServerNames.qveris, type: 'streamableHttp', env: { QVERIS_API_KEY: apiKey ?? '' } })

  it('authenticates QVeris with the API key the user configured', () => {
    expect(getBuiltinHttpHeaders(qveris('secret'))).toEqual({ Authorization: 'Bearer secret' })
  })

  it('fails activation instead of connecting QVeris anonymously', () => {
    expect(() => getBuiltinHttpHeaders(qveris())).toThrow(/QVERIS_API_KEY/)
    expect(() => getBuiltinHttpHeaders(qveris('   '))).toThrow(/QVERIS_API_KEY/)
  })

  it('adds nothing for any other server', () => {
    expect(getBuiltinHttpHeaders(server({ name: BuiltinMcpServerNames.flomo, type: 'streamableHttp' }))).toEqual({})
  })
})

describe('createInMemoryMcpServer', () => {
  it('rejects a name with no in-process implementation', async () => {
    await expect(createInMemoryMcpServer(BuiltinMcpServerNames.mcpAutoInstall)).rejects.toThrow(
      /Unknown in-memory MCP server/
    )
  })
})
