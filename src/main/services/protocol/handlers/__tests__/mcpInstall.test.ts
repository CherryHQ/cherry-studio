import { beforeEach, describe, expect, it, vi } from 'vitest'

const { openSettingsInMainWindowMock } = vi.hoisted(() => ({
  openSettingsInMainWindowMock: vi.fn()
}))

vi.mock('@main/services/mainWindowNavigation', () => ({
  openSettingsInMainWindow: openSettingsInMainWindowMock
}))

import { handleMcpProtocolUrl } from '../mcpInstall'

const createInstallUrl = (payload: unknown) => {
  const servers = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  return new URL(`cherrystudio://mcp/install?servers=${encodeURIComponent(servers)}`)
}

const getPreviewServers = () => {
  const [path] = openSettingsInMainWindowMock.mock.calls.at(-1)!
  const url = new URL(path, 'https://cherry.local')
  const protocolInstall = url.searchParams.get('protocolInstall')
  const requestId = url.searchParams.get('protocolInstallRequestId')
  if (!protocolInstall) throw new Error('Missing protocol install preview payload')
  if (!requestId) throw new Error('Missing protocol install request id')
  return { servers: JSON.parse(protocolInstall), requestId, path: url.pathname }
}

describe('MCP install protocol handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('previews a sanitized single server', () => {
    handleMcpProtocolUrl(
      createInstallUrl({
        name: 'remote-server',
        type: 'streamableHttp',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer token' }
      })
    )

    const { servers, requestId, path } = getPreviewServers()
    expect(path).toBe('/settings/mcp/servers')
    expect(requestId).toEqual(expect.any(String))
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
      handleMcpProtocolUrl(createInstallUrl({ name: 'unsafe-server', command: 'npx', [field]: 'unsafe-value' }))
    ).toThrow()
    expect(openSettingsInMainWindowMock).not.toHaveBeenCalled()
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
    expect(() => handleMcpProtocolUrl(createInstallUrl(server))).toThrow()
    expect(openSettingsInMainWindowMock).not.toHaveBeenCalled()
  })

  it('fills names from mcpServers keys and preserves preview order', () => {
    handleMcpProtocolUrl(
      createInstallUrl({
        mcpServers: {
          first: { command: 'npx', args: ['first-package'], env: { API_KEY: 'secret' } },
          second: { url: 'https://example.com/second', headers: { 'X-Token': 'secret' } }
        }
      })
    )

    const { servers } = getPreviewServers()
    expect(servers.map((server: { name: string }) => server.name)).toEqual(['first', 'second'])
    expect(servers[0]).toMatchObject({ command: 'npx', args: ['first-package'], env: { API_KEY: 'secret' } })
    expect(servers[1]).toMatchObject({
      baseUrl: 'https://example.com/second',
      headers: { 'X-Token': 'secret' }
    })
  })

  it('preserves server array order in the install preview', () => {
    handleMcpProtocolUrl(
      createInstallUrl([
        { name: 'array-first', command: 'uvx' },
        { name: 'array-second', command: 'npx' }
      ])
    )

    const { servers } = getPreviewServers()
    expect(servers.map((server: { name: string }) => server.name)).toEqual(['array-first', 'array-second'])
  })

  it('accepts an mcpServers array wrapper and preserves preview order', () => {
    handleMcpProtocolUrl(
      createInstallUrl({
        mcpServers: [
          { name: 'wrapped-first', command: 'uvx' },
          { name: 'wrapped-second', command: 'npx' }
        ]
      })
    )

    const { servers } = getPreviewServers()
    expect(servers.map((server: { name: string }) => server.name)).toEqual(['wrapped-first', 'wrapped-second'])
  })

  it('assigns a fresh request id to repeated identical previews', () => {
    const url = createInstallUrl({ name: 'repeatable', command: 'npx' })

    handleMcpProtocolUrl(url)
    const firstRequestId = getPreviewServers().requestId
    handleMcpProtocolUrl(url)

    expect(getPreviewServers().requestId).not.toBe(firstRequestId)
  })
})
