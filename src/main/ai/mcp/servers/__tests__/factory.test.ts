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

  it('resolves builtin HTTP endpoints and preserves configured headers', () => {
    expect(
      resolveBuiltinExternalMcpServer(server({ name: BuiltinMcpServerNames.flomo, headers: { Existing: 'value' } }))
    ).toMatchObject({
      type: 'streamableHttp',
      baseUrl: 'https://flomoapp.com/mcp',
      headers: { Existing: 'value', APP: 'Cherry Studio' }
    })
    expect(resolveBuiltinExternalMcpServer(server({ name: BuiltinMcpServerNames.nowledgeMem }))).toMatchObject({
      type: 'streamableHttp',
      baseUrl: 'http://127.0.0.1:14242/mcp',
      headers: { APP: 'Cherry Studio' }
    })
  })

  it('leaves non-builtin servers unchanged', () => {
    const custom = server({ name: 'custom-server', baseUrl: 'https://example.com/mcp' })
    expect(resolveBuiltinExternalMcpServer(custom)).toBe(custom)
  })
})

describe('createBuiltinMcpEndpoint', () => {
  it('rejects a name with no in-process implementation', async () => {
    expect(() => createBuiltinMcpEndpoint(BuiltinMcpServerNames.mcpAutoInstall)).toThrow(/Unknown in-memory MCP server/)
  })
})
