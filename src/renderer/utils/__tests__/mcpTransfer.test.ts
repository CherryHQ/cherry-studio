import { describe, expect, it } from 'vitest'

import { safeValidateMcpConfig } from '@renderer/types/mcp'
import type { McpServer } from '@shared/data/types/mcpServer'

import { DuplicateMcpServerNameError, isExportableMcpServer, serializeMcpServersForExport } from '../mcpTransfer'

function server(name: string, overrides: Partial<McpServer> = {}): McpServer {
  return { id: 'synthetic-id', name, isActive: false, ...overrides }
}

describe('MCP export transfer', () => {
  it('preserves importable configuration and credentials without leaking database or trust fields', () => {
    const content = serializeMcpServersForExport([
      server(' 本地工具 ', {
        type: 'stdio',
        command: 'node',
        args: ['server.js', '--token=synthetic'],
        description: '',
        registryUrl: '',
        env: { TOKEN: 'synthetic-secret', EMPTY: '' },
        headers: { Authorization: 'Bearer synthetic' },
        provider: '',
        providerUrl: '',
        logoUrl: '',
        tags: [],
        longRunning: false,
        timeout: 0,
        dxtVersion: '',
        dxtPath: '/synthetic/package',
        reference: '',
        searchKey: '',
        configSample: { command: 'node', args: [] },
        disabledTools: ['write'],
        disabledAutoApproveTools: [],
        shouldConfig: false,
        sortOrder: 3,
        createdAt: '2026-11-03T00:00:00Z',
        updatedAt: '2026-11-03T00:00:00Z',
        installSource: 'ai_assisted',
        isTrusted: true,
        trustedAt: 1,
        installedAt: 2
      }),
      server('遠端', { type: 'sse', baseUrl: 'https://user:synthetic@example.test/sse?key=synthetic' }),
      server('HTTP', { type: 'streamableHttp', baseUrl: 'https://example.test/mcp', headers: { Key: 'secret' } })
    ])
    expect(JSON.parse(content)).toEqual({
      mcpServers: {
        ' 本地工具 ': {
          name: ' 本地工具 ',
          type: 'stdio',
          command: 'node',
          args: ['server.js', '--token=synthetic'],
          description: '',
          registryUrl: '',
          env: { TOKEN: 'synthetic-secret', EMPTY: '' },
          headers: { Authorization: 'Bearer synthetic' },
          provider: '',
          providerUrl: '',
          logoUrl: '',
          tags: [],
          longRunning: false,
          timeout: 0,
          dxtVersion: '',
          dxtPath: '/synthetic/package',
          reference: '',
          searchKey: '',
          configSample: { command: 'node', args: [] },
          disabledTools: ['write'],
          disabledAutoApproveTools: [],
          shouldConfig: false
        },
        遠端: { name: '遠端', type: 'sse', url: 'https://user:synthetic@example.test/sse?key=synthetic' },
        HTTP: { name: 'HTTP', type: 'streamableHttp', url: 'https://example.test/mcp', headers: { Key: 'secret' } }
      }
    })
    const validated = safeValidateMcpConfig(JSON.parse(content))
    expect(validated.success).toBe(true)
    if (!validated.success) throw validated.error
    expect(Object.keys(validated.data.mcpServers)).toHaveLength(3)
    for (const record of Object.values(JSON.parse(content).mcpServers)) {
      for (const key of [
        'id',
        'sortOrder',
        'createdAt',
        'updatedAt',
        'isActive',
        'installSource',
        'isTrusted',
        'trustedAt',
        'installedAt',
        'baseUrl'
      ]) {
        expect(record).not.toHaveProperty(key)
      }
    }
  })

  it('preserves runtime transport defaults instead of letting the importer change URL servers to stdio', () => {
    expect(
      JSON.parse(
        serializeMcpServersForExport([
          server('url', { baseUrl: 'https://example.test/mcp' }),
          server('command', { command: 'npx' }),
          server('explicit', { type: 'streamableHttp', baseUrl: 'https://example.test/sse' })
        ])
      ).mcpServers
    ).toEqual({
      url: { name: 'url', type: 'sse', url: 'https://example.test/mcp' },
      command: { name: 'command', type: 'stdio', command: 'npx' },
      explicit: { name: 'explicit', type: 'streamableHttp', url: 'https://example.test/sse' }
    })
  })

  it('excludes all builtin forms before detecting name collisions', () => {
    const builtin = server('same', { type: 'stdio', installSource: 'builtin' })
    expect(isExportableMcpServer(builtin)).toBe(false)
    expect(
      JSON.parse(
        serializeMcpServersForExport([
          builtin,
          server('@cherry/filesystem', { type: 'stdio' }),
          server('same', { type: 'inMemory' }),
          server('same', { command: 'node' })
        ])
      ).mcpServers
    ).toEqual({ same: { name: 'same', type: 'stdio', command: 'node' } })
    expect(() => serializeMcpServersForExport([builtin])).toThrow()
    expect(() => serializeMcpServersForExport([])).toThrow()
  })

  it('refuses exact duplicates but preserves case-distinct names', () => {
    expect(() => serializeMcpServersForExport([server('same'), server('same')])).toThrow(DuplicateMcpServerNameError)
    try {
      serializeMcpServersForExport([server('same'), server('same')])
    } catch (error) {
      expect(error).toMatchObject({ serverName: 'same' })
    }
    expect(Object.keys(JSON.parse(serializeMcpServersForExport([server('Same'), server('same')])).mcpServers)).toEqual([
      'Same',
      'same'
    ])
  })

  it('refuses proto keys that the importer silently drops but preserves constructor', () => {
    expect(() => serializeMcpServersForExport([server('ordinary'), server('__proto__')])).toThrow()
    const payload = JSON.parse(serializeMcpServersForExport([server('constructor')]))
    expect(Object.hasOwn(payload.mcpServers, 'constructor')).toBe(true)
    expect(payload.mcpServers.constructor).toEqual({ name: 'constructor', type: 'stdio' })
    const parsed = safeValidateMcpConfig(payload)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(Object.keys(parsed.data.mcpServers)).toEqual(['constructor'])
  })

  it('rejects configuration that cannot pass the unchanged strict importer', () => {
    expect(() => serializeMcpServersForExport([server('bad', { timeout: NaN })])).toThrow()
  })
})
