import type { McpServer } from '@shared/data/types/mcpServer'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'
import { describe, expect, it } from 'vitest'

import { createBuiltinMcpEndpoint, resolveBuiltinExternalMcpServer } from '../factory'

const server = (overrides: Partial<McpServer>): McpServer =>
  ({ id: 'id', name: 'custom', type: 'stdio', isActive: true, ...overrides }) as McpServer

describe('resolveBuiltinExternalMcpServer', () => {
  const qveris = (apiKey?: string) =>
    server({
      name: BuiltinMcpServerNames.qveris,
      type: 'streamableHttp',
      installSource: 'builtin',
      env: { QVERIS_API_KEY: apiKey ?? '' }
    })

  it('authenticates QVeris with the API key the user configured', () => {
    expect(resolveBuiltinExternalMcpServer(qveris('secret')).headers).toEqual({ Authorization: 'Bearer secret' })
  })

  it('fails activation instead of connecting QVeris anonymously', () => {
    expect(() => resolveBuiltinExternalMcpServer(qveris())).toThrow(/QVERIS_API_KEY/)
    expect(() => resolveBuiltinExternalMcpServer(qveris('   '))).toThrow(/QVERIS_API_KEY/)
  })

  it('leaves connection data unchanged for servers without an auth projection', () => {
    for (const candidate of [
      server({ name: BuiltinMcpServerNames.flomo, baseUrl: 'https://flomoapp.com/mcp' }),
      server({ name: BuiltinMcpServerNames.nowledgeMem, baseUrl: 'http://127.0.0.1:14242/mcp' }),
      server({ name: 'custom-server', baseUrl: 'https://example.com/mcp' })
    ]) {
      expect(resolveBuiltinExternalMcpServer(candidate)).toBe(candidate)
    }
  })
})

describe('createBuiltinMcpEndpoint', () => {
  it('rejects a name with no in-process implementation', async () => {
    expect(() => createBuiltinMcpEndpoint(BuiltinMcpServerNames.mcpAutoInstall)).toThrow(
      /Unknown in-process MCP server/
    )
  })
})
