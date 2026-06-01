import type { MCPServer } from '@shared/data/types/mcpServer'
import { describe, expect, it } from 'vitest'

import { isSameMcpServerInstall } from '../identity'

function server(overrides: Partial<MCPServer>): MCPServer {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    name: 'server',
    isActive: true,
    ...overrides
  }
}

describe('isSameMcpServerInstall', () => {
  it('matches provider servers by providerUrl after create replaces the synthetic id', () => {
    const installed = server({
      id: '11111111-1111-4111-8111-111111111111',
      provider: 'ModelScope',
      providerUrl: 'https://modelscope.cn/mcp/servers/demo'
    })
    const marketplace = server({
      id: '@modelscope/demo',
      provider: 'ModelScope',
      providerUrl: 'https://modelscope.cn/mcp/servers/demo'
    })

    expect(isSameMcpServerInstall(installed, marketplace)).toBe(true)
  })

  it('matches provider servers by baseUrl when providerUrl is absent', () => {
    const installed = server({
      id: '11111111-1111-4111-8111-111111111111',
      provider: 'LanYun',
      baseUrl: 'https://mcp.lanyun.net/demo'
    })
    const marketplace = server({
      id: '@lanyun/demo',
      provider: 'LanYun',
      baseUrl: 'https://mcp.lanyun.net/demo'
    })

    expect(isSameMcpServerInstall(installed, marketplace)).toBe(true)
  })

  it('does not match provider servers with different stable urls', () => {
    const installed = server({
      id: '11111111-1111-4111-8111-111111111111',
      provider: 'TokenFlux',
      providerUrl: 'https://tokenflux.ai/mcps/installed'
    })
    const marketplace = server({
      id: '@tokenflux/other',
      provider: 'TokenFlux',
      providerUrl: 'https://tokenflux.ai/mcps/other'
    })

    expect(isSameMcpServerInstall(installed, marketplace)).toBe(false)
  })
})
