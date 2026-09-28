import { describe, expect, it } from 'vitest'

import { ZONEFOUNDRY_MCP_BASE_URL, ZONEFOUNDRY_MCP_BASE_URL_CN } from '@shared/data/presets/zonefoundryMcp'
import type { McpServer } from '@shared/data/types/mcpServer'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'
import { resolveBuiltinMcpConnectBaseUrl } from '@shared/utils/mcpBuiltinConnect'

const zonefoundryServer = (): McpServer =>
  ({
    id: '00000000-0000-4000-8000-000000000001',
    name: BuiltinMcpServerNames.zonefoundry,
    type: 'streamableHttp',
    baseUrl: ZONEFOUNDRY_MCP_BASE_URL,
    installSource: 'builtin',
    isActive: true
  })

describe('resolveBuiltinMcpConnectBaseUrl', () => {
  it('uses the China accelerator for the ZoneFoundry builtin when egress is in China', () => {
    expect(resolveBuiltinMcpConnectBaseUrl(zonefoundryServer(), true)).toBe(ZONEFOUNDRY_MCP_BASE_URL_CN)
  })

  it('uses the global endpoint for ZoneFoundry outside China', () => {
    expect(resolveBuiltinMcpConnectBaseUrl(zonefoundryServer(), false)).toBe(ZONEFOUNDRY_MCP_BASE_URL)
  })

  it('leaves other servers on their stored baseUrl', () => {
    const server = {
      ...zonefoundryServer(),
      name: BuiltinMcpServerNames.flomo,
      baseUrl: 'https://flomoapp.com/mcp'
    }
    expect(resolveBuiltinMcpConnectBaseUrl(server, true)).toBe('https://flomoapp.com/mcp')
  })
})
