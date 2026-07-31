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

describe('MCP install protocol handler', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists a single server with a database ID and forced protocol security fields', async () => {
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

    const [server] = await dbh.db.select().from(mcpServerTable)
    expect(server).toMatchObject({
      name: 'remote-server',
      type: 'streamableHttp',
      baseUrl: 'https://example.com/mcp',
      installSource: 'protocol',
      isActive: false,
      isTrusted: false,
      trustedAt: null
    })
    expect(server.id).not.toBe('caller-controlled-id')
    expect(server.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(server.installedAt).toEqual(expect.any(Number))
    expect(openSettingsInMainWindowMock).toHaveBeenCalledWith(`/settings/mcp/settings/${server.id}`, {
      delivery: 'init-data'
    })
  })

  it('fills names from mcpServers keys and opens the last created server', async () => {
    handleMcpProtocolUrl(
      createInstallUrl({
        mcpServers: {
          first: { command: 'npx', args: ['first-package'] },
          second: { url: 'https://example.com/second' }
        }
      })
    )

    const servers = await dbh.db.select().from(mcpServerTable)
    const first = servers.find((server) => server.name === 'first')
    const second = servers.find((server) => server.name === 'second')

    expect(first).toMatchObject({ command: 'npx', args: ['first-package'] })
    expect(second).toMatchObject({ baseUrl: 'https://example.com/second' })
    expect(openSettingsInMainWindowMock).toHaveBeenCalledWith(`/settings/mcp/settings/${second!.id}`, {
      delivery: 'init-data'
    })
  })

  it('persists server arrays in order and opens the last created server', async () => {
    handleMcpProtocolUrl(
      createInstallUrl([
        { name: 'array-first', command: 'uvx' },
        { name: 'array-second', command: 'npx' }
      ])
    )

    const servers = await dbh.db.select().from(mcpServerTable)
    expect(servers.map((server) => server.name)).toEqual(['array-first', 'array-second'])
    expect(openSettingsInMainWindowMock).toHaveBeenCalledWith(`/settings/mcp/settings/${servers[1].id}`, {
      delivery: 'init-data'
    })
  })
})
