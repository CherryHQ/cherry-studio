import { describe, expect, it } from 'vitest'

import { parseMcpInstallProtocolUrl } from '../mcpInstall'

const createInstallUrl = (payload: unknown) => {
  const servers = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  return new URL(`cherrystudio://mcp/install?servers=${encodeURIComponent(servers)}`)
}

const parsePreviewServers = (payload: unknown) => {
  const servers = parseMcpInstallProtocolUrl(createInstallUrl(payload))
  if (!servers) throw new Error('Missing protocol install preview payload')
  return servers
}

describe('MCP install protocol handler', () => {
  it('previews a sanitized single server', () => {
    const servers = parsePreviewServers({
      name: 'remote-server',
      type: 'streamableHttp',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' }
    })

    expect(servers).toHaveLength(1)
    expect(servers[0]).toMatchObject({
      name: 'remote-server',
      type: 'streamableHttp',
      baseUrl: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
      installSource: 'protocol',
      isActive: false,
      isTrusted: false
    })
    expect(servers[0].installedAt).toEqual(expect.any(Number))
    expect(servers[0]).not.toHaveProperty('url')
    expect(servers[0]).not.toHaveProperty('trustedAt')
  })

  it.each(['id', 'dxtPath'])('rejects the unreviewed %s field', (field) => {
    expect(() =>
      parseMcpInstallProtocolUrl(createInstallUrl({ name: 'unsafe-server', command: 'npx', [field]: 'unsafe-value' }))
    ).toThrow()
  })

  it.each([
    {
      name: 'ambiguous-server',
      baseUrl: 'https://example.com/mcp',
      command: 'npx',
      args: ['unsafe-package']
    },
    { name: 'url-with-stdio', type: 'stdio', baseUrl: 'https://example.com/mcp' },
    { name: 'command-with-sse', type: 'sse', command: 'npx' }
  ])('rejects ambiguous or conflicting connection settings', (server) => {
    expect(() => parseMcpInstallProtocolUrl(createInstallUrl(server))).toThrow()
  })

  it('fills names from mcpServers keys and preserves preview order', () => {
    const servers = parsePreviewServers({
      mcpServers: {
        first: { command: 'npx', args: ['first-package'], env: { API_KEY: 'secret' } },
        second: { url: 'https://example.com/second', headers: { 'X-Token': 'secret' } }
      }
    })

    expect(servers.map((server: { name: string }) => server.name)).toEqual(['first', 'second'])
    expect(servers[0]).toMatchObject({
      type: 'stdio',
      command: 'npx',
      args: ['first-package'],
      env: { API_KEY: 'secret' }
    })
    expect(servers[1]).toMatchObject({
      type: 'sse',
      baseUrl: 'https://example.com/second',
      headers: { 'X-Token': 'secret' }
    })
  })

  it('preserves server array order in the install preview', () => {
    const servers = parsePreviewServers([
      { name: 'array-first', command: 'uvx' },
      { name: 'array-second', command: 'npx' }
    ])

    expect(servers.map((server: { name: string }) => server.name)).toEqual(['array-first', 'array-second'])
  })

  it('accepts an mcpServers array wrapper and preserves preview order', () => {
    const servers = parsePreviewServers({
      mcpServers: [
        { name: 'wrapped-first', command: 'uvx' },
        { name: 'wrapped-second', command: 'npx' }
      ]
    })

    expect(servers.map((server: { name: string }) => server.name)).toEqual(['wrapped-first', 'wrapped-second'])
  })
})
