import type { MCPServer, MCPTool, MCPToolResponse } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- Mocks ---

const mockUpdateMCPServer = vi.fn()
const mockMcpServers: MCPServer[] = []

vi.mock('@renderer/hooks/useMCPServers', () => ({
  useMCPServers: () => ({
    mcpServers: mockMcpServers,
    updateMCPServer: mockUpdateMCPServer
  })
}))

vi.mock('@renderer/hooks/agents/useActiveAgent', () => ({
  useActiveAgent: () => ({ agent: null })
}))

vi.mock('@renderer/utils/mcp-tools', () => ({
  isToolAutoApproved: vi.fn(() => false)
}))

const mockConfirmToolAction = vi.fn<(id: string) => void>()
const mockCancelToolAction = vi.fn<(id: string) => void>()
const mockIsToolPending = vi.fn<(id: string) => boolean>().mockReturnValue(false)
const mockOnToolPendingChange = vi.fn<(listener: (toolId: string) => void) => () => void>().mockReturnValue(() => {})

vi.mock('@renderer/utils/userConfirmation', () => ({
  confirmToolAction: (id: string) => mockConfirmToolAction(id),
  cancelToolAction: (id: string) => mockCancelToolAction(id),
  isToolPending: (id: string) => mockIsToolPending(id),
  onToolPendingChange: (listener: (toolId: string) => void) => mockOnToolPendingChange(listener)
}))

vi.mock('@renderer/store', () => ({
  default: {
    getState: vi.fn(() => ({ mcp: { servers: [] } })),
    dispatch: vi.fn(),
    subscribe: vi.fn()
  }
}))

vi.mock('@renderer/store/mcp', () => ({
  hubMCPServer: { id: 'hub', name: 'MCP Hub', type: 'inMemory', isActive: true },
  addMCPServer: vi.fn()
}))

vi.mock('@renderer/store/assistants', () => ({
  default: vi.fn(),
  setDefaultAssistant: vi.fn()
}))

vi.mock('@renderer/services/AssistantService', () => ({
  getDefaultAssistant: vi.fn(() => ({})),
  getDefaultTopic: vi.fn(() => ({}))
}))

vi.mock('@renderer/i18n', () => ({
  default: { t: vi.fn((key: string) => key) }
}))

vi.mock('@renderer/services/SpanManagerService', () => ({
  currentSpan: vi.fn()
}))

vi.mock('@renderer/config/models', () => ({
  isFunctionCallingModel: vi.fn(),
  isVisionModel: vi.fn()
}))

// Mock window.api.mcp.resolveHubTool and window.toast
const mockResolveHubTool = vi.fn()
vi.stubGlobal('api', {
  ...(globalThis as any).api,
  mcp: { resolveHubTool: mockResolveHubTool }
})
vi.stubGlobal('toast', { success: vi.fn() })

import { isToolAutoApproved } from '@renderer/utils/mcp-tools'

import { useMcpToolApproval } from '../useMcpToolApproval'

// --- Helpers ---

function makeTool(overrides: Partial<MCPTool> = {}): MCPTool {
  return {
    id: 'server1__tool1',
    name: 'tool1',
    serverId: 'server1',
    serverName: 'Server 1',
    description: 'A test tool',
    inputSchema: { type: 'object' },
    type: 'mcp',
    ...overrides
  }
}

function makeServer(overrides: Partial<MCPServer> = {}): MCPServer {
  return {
    id: 'server1',
    name: 'Server 1',
    type: 'stdio',
    isActive: true,
    command: 'test',
    ...overrides
  } as MCPServer
}

function makeBlock(toolResponse?: Partial<MCPToolResponse>): ToolMessageBlock {
  return {
    id: 'block-1',
    messageId: 'msg-1',
    type: MessageBlockType.TOOL,
    status: MessageBlockStatus.SUCCESS,
    toolId: 'tool1',
    createdAt: new Date().toISOString(),
    metadata: toolResponse
      ? {
          rawMcpToolResponse: {
            id: 'tool-action-1',
            tool: makeTool(),
            arguments: undefined,
            status: 'pending',
            ...toolResponse
          } as MCPToolResponse
        }
      : undefined
  }
}

// --- Tests ---

describe('useMcpToolApproval', () => {
  beforeEach(() => {
    mockMcpServers.length = 0
    vi.clearAllMocks()
    ;(isToolAutoApproved as ReturnType<typeof vi.fn>).mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('approval state', () => {
    it('returns isWaiting=true when pending and not auto-approved', () => {
      mockIsToolPending.mockReturnValue(false)
      const block = makeBlock({ status: 'pending' })

      const { result } = renderHook(() => useMcpToolApproval(block))

      expect(result.current.isWaiting).toBe(true)
      expect(result.current.isExecuting).toBe(false)
    })

    it('returns isExecuting=true when pending and auto-approved', () => {
      ;(isToolAutoApproved as ReturnType<typeof vi.fn>).mockReturnValue(true)
      const block = makeBlock({ status: 'pending' })

      const { result } = renderHook(() => useMcpToolApproval(block))

      expect(result.current.isWaiting).toBe(false)
      expect(result.current.isExecuting).toBe(true)
    })

    it('returns both false when status is done', () => {
      const block = makeBlock({ status: 'done' })

      const { result } = renderHook(() => useMcpToolApproval(block))

      expect(result.current.isWaiting).toBe(false)
      expect(result.current.isExecuting).toBe(false)
    })

    it('detects pending during streaming via isToolPending', () => {
      mockIsToolPending.mockReturnValue(true)
      const block = makeBlock({ status: 'streaming' })

      const { result } = renderHook(() => useMcpToolApproval(block))

      expect(result.current.isWaiting).toBe(true)
    })
  })

  describe('confirm', () => {
    it('calls confirmToolAction and sets isConfirmed', () => {
      const block = makeBlock({ status: 'pending', id: 'tool-123' })

      const { result } = renderHook(() => useMcpToolApproval(block))

      act(() => {
        result.current.confirm()
      })

      expect(mockConfirmToolAction).toHaveBeenCalledWith('tool-123')
    })
  })

  describe('cancel', () => {
    it('calls cancelToolAction', () => {
      const block = makeBlock({ status: 'pending', id: 'tool-123' })

      const { result } = renderHook(() => useMcpToolApproval(block))

      act(() => {
        result.current.cancel()
      })

      expect(mockCancelToolAction).toHaveBeenCalledWith('tool-123')
    })
  })

  describe('autoApprove', () => {
    it('removes tool from disabledAutoApproveTools on the server', async () => {
      const server = makeServer({
        id: 'server1',
        disabledAutoApproveTools: ['tool1', 'tool2']
      })
      mockMcpServers.push(server)

      const block = makeBlock({
        status: 'pending',
        id: 'tool-123',
        tool: makeTool({ serverId: 'server1', name: 'tool1' })
      })

      const { result } = renderHook(() => useMcpToolApproval(block))

      await act(async () => {
        await result.current.autoApprove?.()
      })

      expect(mockUpdateMCPServer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'server1',
          disabledAutoApproveTools: ['tool2']
        })
      )
      expect(mockConfirmToolAction).toHaveBeenCalledWith('tool-123')
      expect(window.toast.success).toHaveBeenCalled()
    })

    it('confirms the tool even if server is not found', async () => {
      // No servers in the list
      const block = makeBlock({
        status: 'pending',
        id: 'tool-123',
        tool: makeTool({ serverId: 'nonexistent', name: 'tool1' })
      })

      const { result } = renderHook(() => useMcpToolApproval(block))

      await act(async () => {
        await result.current.autoApprove?.()
      })

      expect(mockUpdateMCPServer).not.toHaveBeenCalled()
      expect(mockConfirmToolAction).toHaveBeenCalledWith('tool-123')
    })

    it('does nothing if tool is missing', async () => {
      const block = makeBlock()
      // Remove the tool response entirely
      block.metadata = undefined

      const { result } = renderHook(() => useMcpToolApproval(block))

      await act(async () => {
        await result.current.autoApprove?.()
      })

      expect(mockUpdateMCPServer).not.toHaveBeenCalled()
      expect(mockConfirmToolAction).not.toHaveBeenCalled()
    })

    describe('hub tool resolution', () => {
      it('resolves hub invoke tool to underlying server and updates auto-approve', async () => {
        const underlyingServer = makeServer({
          id: 'actual-server',
          disabledAutoApproveTools: ['real_tool', 'other_tool']
        })
        mockMcpServers.push(underlyingServer)

        mockResolveHubTool.mockResolvedValue({
          serverId: 'actual-server',
          toolName: 'real_tool'
        })

        const block = makeBlock({
          status: 'pending',
          id: 'tool-hub-1',
          tool: makeTool({ serverId: 'hub', name: 'invoke' }),
          arguments: { name: 'real_tool' }
        })

        const { result } = renderHook(() => useMcpToolApproval(block))

        await act(async () => {
          await result.current.autoApprove?.()
        })

        expect(mockResolveHubTool).toHaveBeenCalledWith('real_tool')
        expect(mockUpdateMCPServer).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'actual-server',
            disabledAutoApproveTools: ['other_tool']
          })
        )
        expect(mockConfirmToolAction).toHaveBeenCalledWith('tool-hub-1')
        expect(window.toast.success).toHaveBeenCalled()
      })

      it('resolves hub exec tool similarly', async () => {
        const underlyingServer = makeServer({
          id: 'actual-server',
          disabledAutoApproveTools: ['real_tool']
        })
        mockMcpServers.push(underlyingServer)

        mockResolveHubTool.mockResolvedValue({
          serverId: 'actual-server',
          toolName: 'real_tool'
        })

        const block = makeBlock({
          status: 'pending',
          id: 'tool-hub-2',
          tool: makeTool({ serverId: 'hub', name: 'exec' }),
          arguments: { name: 'real_tool' }
        })

        const { result } = renderHook(() => useMcpToolApproval(block))

        await act(async () => {
          await result.current.autoApprove?.()
        })

        expect(mockResolveHubTool).toHaveBeenCalledWith('real_tool')
        expect(mockUpdateMCPServer).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'actual-server',
            disabledAutoApproveTools: []
          })
        )
        expect(mockConfirmToolAction).toHaveBeenCalledWith('tool-hub-2')
      })

      it('falls back to confirm when resolveHubTool returns null', async () => {
        mockResolveHubTool.mockResolvedValue(null)

        const block = makeBlock({
          status: 'pending',
          id: 'tool-hub-3',
          tool: makeTool({ serverId: 'hub', name: 'invoke' }),
          arguments: { name: 'unknown_tool' }
        })

        const { result } = renderHook(() => useMcpToolApproval(block))

        await act(async () => {
          await result.current.autoApprove?.()
        })

        expect(mockResolveHubTool).toHaveBeenCalledWith('unknown_tool')
        expect(mockUpdateMCPServer).not.toHaveBeenCalled()
        // Should still confirm the current tool
        expect(mockConfirmToolAction).toHaveBeenCalledWith('tool-hub-3')
      })

      it('falls back to confirm when resolveHubTool throws', async () => {
        mockResolveHubTool.mockRejectedValue(new Error('IPC error'))

        const block = makeBlock({
          status: 'pending',
          id: 'tool-hub-4',
          tool: makeTool({ serverId: 'hub', name: 'invoke' }),
          arguments: { name: 'failing_tool' }
        })

        const { result } = renderHook(() => useMcpToolApproval(block))

        await act(async () => {
          await result.current.autoApprove?.()
        })

        expect(mockUpdateMCPServer).not.toHaveBeenCalled()
        // Should still confirm the current tool via the !server fallback
        expect(mockConfirmToolAction).toHaveBeenCalledWith('tool-hub-4')
      })

      it('falls back to confirm when resolved server is not found in mcpServers', async () => {
        mockResolveHubTool.mockResolvedValue({
          serverId: 'missing-server',
          toolName: 'some_tool'
        })

        const block = makeBlock({
          status: 'pending',
          id: 'tool-hub-5',
          tool: makeTool({ serverId: 'hub', name: 'invoke' }),
          arguments: { name: 'some_tool' }
        })

        const { result } = renderHook(() => useMcpToolApproval(block))

        await act(async () => {
          await result.current.autoApprove?.()
        })

        expect(mockUpdateMCPServer).not.toHaveBeenCalled()
        expect(mockConfirmToolAction).toHaveBeenCalledWith('tool-hub-5')
      })

      it('skips hub resolution when arguments have no name', async () => {
        const block = makeBlock({
          status: 'pending',
          id: 'tool-hub-6',
          tool: makeTool({ serverId: 'hub', name: 'invoke' }),
          arguments: { other: 'value' }
        })

        const { result } = renderHook(() => useMcpToolApproval(block))

        await act(async () => {
          await result.current.autoApprove?.()
        })

        expect(mockResolveHubTool).not.toHaveBeenCalled()
        // Falls through to !server path and confirms
        expect(mockConfirmToolAction).toHaveBeenCalledWith('tool-hub-6')
      })
    })
  })

  describe('autoApprove availability', () => {
    it('provides autoApprove when isWaiting is true', () => {
      const block = makeBlock({ status: 'pending' })

      const { result } = renderHook(() => useMcpToolApproval(block))

      expect(result.current.autoApprove).toBeDefined()
    })

    it('does not provide autoApprove when not waiting', () => {
      const block = makeBlock({ status: 'done' })

      const { result } = renderHook(() => useMcpToolApproval(block))

      expect(result.current.autoApprove).toBeUndefined()
    })
  })
})
