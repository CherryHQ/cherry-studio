import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PRESET_MCP_SERVERS } from '@shared/data/presets/mcpServers'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

import { mcpServerHandlers } from '../mcpServers'

const trackProductEvent = vi.fn()

describe('POST /mcp-servers usage analytics', () => {
  setupTestDatabase()

  beforeEach(() => {
    trackProductEvent.mockReset()
    MockApplicationUtils.setService('AnalyticsService', { trackProductEvent })
  })
  afterEach(() => MockApplicationUtils.resetServices())

  const reported = () => trackProductEvent.mock.calls.map(([event]) => event)

  it('names a builtin server by its preset slug', async () => {
    const preset = PRESET_MCP_SERVERS.find((server) => server.name === BuiltinMcpServerNames.fetch)!
    await mcpServerHandlers['/mcp-servers'].POST({ body: { ...preset } })

    expect(reported()).toEqual([
      { event: 'feature_used', feature: 'mcp', action: 'server_added', status: 'success', target: 'fetch' }
    ])
  })

  it('reports a user-defined server without its name, even when it claims the builtin prefix', async () => {
    await mcpServerHandlers['/mcp-servers'].POST({
      body: { name: 'My private server', type: 'stdio', command: 'node', installSource: 'manual' }
    } as never)
    await mcpServerHandlers['/mcp-servers'].POST({
      body: { name: '@cherry/not-a-preset', type: 'stdio', command: 'node', installSource: 'builtin' }
    } as never)

    expect(reported()).toEqual([
      { event: 'feature_used', feature: 'mcp', action: 'server_added', status: 'success' },
      { event: 'feature_used', feature: 'mcp', action: 'server_added', status: 'success' }
    ])
  })

  it('reports a rejected server as an error', async () => {
    await expect(
      mcpServerHandlers['/mcp-servers'].POST({ body: { name: '   ', type: 'stdio', command: 'node' } } as never)
    ).rejects.toThrow()
    expect(reported()).toEqual([{ event: 'feature_used', feature: 'mcp', action: 'server_added', status: 'error' }])
  })
})
