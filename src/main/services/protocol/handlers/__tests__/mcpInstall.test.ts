import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { setupTestDatabase } from '@test-helpers/db'
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
  const [path, options] = openSettingsInMainWindowMock.mock.calls.at(-1)!
  const url = new URL(path, 'https://cherry.local')
  const protocolInstall = url.searchParams.get('protocolInstall')
  if (!protocolInstall) throw new Error('Missing protocol install preview payload')
  return { servers: JSON.parse(protocolInstall), path: url.pathname, options }
}

describe('MCP install protocol handler', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('previews a sanitized single server without persisting it before confirmation', async () => {
    handleMcpProtocolUrl(
      createInstallUrl({
        id: 'caller-controlled-id',
        name: 'remote-server',
        type: 'streamableHttp',
        url: 'https://example.com/mcp',
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-01-01T00:00:00.000Z',
        installSource: 'manual',
        isActive: true,
        isTrusted: true,
        trustedAt: 123
      })
    )

    expect(await dbh.db.select().from(mcpServerTable)).toEqual([])

    const { servers, path, options } = getPreviewServers()
    expect(path).toBe('/settings/mcp/servers')
    expect(options).toEqual({ delivery: 'init-data' })
    expect(servers).toHaveLength(1)
    expect(servers[0]).toMatchObject({
      name: 'remote-server',
      type: 'streamableHttp',
      baseUrl: 'https://example.com/mcp',
      installSource: 'protocol',
      isActive: false,
      isTrusted: false
    })
    expect(servers[0].installedAt).toEqual(expect.any(Number))
    expect(servers[0]).not.toHaveProperty('id')
    expect(servers[0]).not.toHaveProperty('createdAt')
    expect(servers[0]).not.toHaveProperty('updatedAt')
    expect(servers[0]).not.toHaveProperty('url')
    expect(servers[0]).not.toHaveProperty('trustedAt')
  })

  it('fills names from mcpServers keys and preserves preview order', () => {
    handleMcpProtocolUrl(
      createInstallUrl({
        mcpServers: {
          first: { command: 'npx', args: ['first-package'] },
          second: { url: 'https://example.com/second' }
        }
      })
    )

    const { servers } = getPreviewServers()
    expect(servers.map((server: { name: string }) => server.name)).toEqual(['first', 'second'])
    expect(servers[0]).toMatchObject({ command: 'npx', args: ['first-package'] })
    expect(servers[1]).toMatchObject({ baseUrl: 'https://example.com/second' })
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
})
