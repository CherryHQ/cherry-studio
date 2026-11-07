import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { McpToolResponse } from '@renderer/types/mcpTool'
import type { McpTool } from '@renderer/types/tool'
import { buildMcpWireWildcard } from '@shared/ai/tools/mcpSourcePolicy'
import type { McpServer } from '@shared/data/types/mcpServer'

import { useToolApproval } from '../useToolApproval'
const m = vi.hoisted(() => ({
  servers: [] as McpServer[],
  update: vi.fn(),
  respond: vi.fn(),
  match: { approvalId: 'approval', state: 'approval-requested', input: {} }
}))
vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServers: () => ({ mcpServers: m.servers }),
  useMcpServerMutations: () => ({ updateMcpServer: m.update })
}))
vi.mock('@renderer/components/chat/messages/blocks/MessagePartsContext', () => ({ useScopedPartsMap: () => new Map() }))
vi.mock('../../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => ({ respondToolApproval: m.respond })
}))
vi.mock('../../toolResponse', () => ({
  APPROVAL_REQUESTED: 'approval-requested',
  APPROVAL_RESPONDED: 'approval-responded',
  findToolPartByCallId: () => m.match
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const tool = { name: 'play', serverId: 'server' } as McpTool
const target = { toolCallId: 'call' } as McpToolResponse
beforeEach(() => {
  vi.clearAllMocks()
  m.respond.mockResolvedValue(undefined)
  m.update.mockResolvedValue(undefined)
  m.servers = [
    {
      id: 'server',
      name: 'Cherry Zonefoundry',
      disabledAutoApproveTools: [buildMcpWireWildcard('Cherry Zonefoundry')]
    } as McpServer
  ]
})
describe('MCP wildcard mandatory approval', () => {
  it('omits always-allow under wildcard while keeping one-time confirm and cancel', async () => {
    const { result } = renderHook(() => useToolApproval(target, tool))
    expect(result.current.autoApprove).toBeUndefined()
    await act(async () => {
      await result.current.confirm()
    })
    expect(m.respond).toHaveBeenCalledWith(expect.objectContaining({ approved: true }))
    expect(m.update).not.toHaveBeenCalled()
  })
  it('keeps cancel available and fail-closes while the server has not loaded', async () => {
    const { result } = renderHook(() => useToolApproval(target, tool))
    await act(async () => {
      await result.current.cancel()
    })
    expect(m.respond).toHaveBeenCalledWith(expect.objectContaining({ approved: false }))
    m.servers = []
    const missing = renderHook(() => useToolApproval(target, tool))
    expect(missing.result.current.autoApprove).toBeUndefined()
    expect(m.update).not.toHaveBeenCalled()
  })

  it('keeps ordinary per-tool always-allow persistence', async () => {
    m.servers[0].disabledAutoApproveTools = ['play', 'pause']
    const { result } = renderHook(() => useToolApproval(target, tool))
    expect(result.current.autoApprove).toBeTypeOf('function')
    await act(async () => {
      await result.current.autoApprove?.()
    })
    expect(m.update).toHaveBeenCalledWith({ body: { disabledAutoApproveTools: ['pause'] } })
  })
  it('does not let another server wildcard suppress this server action', () => {
    m.servers[0].disabledAutoApproveTools = [buildMcpWireWildcard('other')]
    const { result } = renderHook(() => useToolApproval(target, tool))
    expect(result.current.autoApprove).toBeTypeOf('function')
  })
})
