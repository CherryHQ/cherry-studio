import type { MCPServer, MCPTool } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

// Mock all transitive dependencies that cause initialization errors
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

import { isToolAutoApproved } from '../mcp-tools'

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

describe('isToolAutoApproved', () => {
  describe('built-in tools', () => {
    it('returns true for built-in tools', () => {
      const tool = makeTool({ isBuiltIn: true })
      expect(isToolAutoApproved(tool)).toBe(true)
    })
  })

  describe('agent allowed_tools', () => {
    it('returns true when tool.id is in allowedTools', () => {
      const tool = makeTool({ id: 'server1__tool1' })
      expect(isToolAutoApproved(tool, undefined, ['server1__tool1'])).toBe(true)
    })

    it('returns false when tool.id is not in allowedTools', () => {
      const tool = makeTool({ id: 'server1__tool1' })
      const server = makeServer({ disabledAutoApproveTools: ['tool1'] })
      expect(isToolAutoApproved(tool, server, ['other_tool'])).toBe(false)
    })
  })

  describe('server-level auto-approve', () => {
    it('returns true when tool is not in disabledAutoApproveTools', () => {
      const tool = makeTool({ name: 'tool1' })
      const server = makeServer({ disabledAutoApproveTools: ['other_tool'] })
      expect(isToolAutoApproved(tool, server)).toBe(true)
    })

    it('returns false when tool is in disabledAutoApproveTools', () => {
      const tool = makeTool({ name: 'tool1' })
      const server = makeServer({ disabledAutoApproveTools: ['tool1'] })
      expect(isToolAutoApproved(tool, server)).toBe(false)
    })

    it('returns true when disabledAutoApproveTools is undefined', () => {
      const tool = makeTool({ name: 'tool1' })
      const server = makeServer({ disabledAutoApproveTools: undefined })
      expect(isToolAutoApproved(tool, server)).toBe(true)
    })

    it('returns false when server is not found', () => {
      const tool = makeTool({ serverId: 'nonexistent' })
      expect(isToolAutoApproved(tool)).toBe(false)
    })
  })

  describe('hub server', () => {
    it('auto-approves list meta-tool', () => {
      const tool = makeTool({ serverId: 'hub', name: 'list' })
      const hubServer = makeServer({ id: 'hub' })
      expect(isToolAutoApproved(tool, hubServer)).toBe(true)
    })

    it('auto-approves inspect meta-tool', () => {
      const tool = makeTool({ serverId: 'hub', name: 'inspect' })
      const hubServer = makeServer({ id: 'hub' })
      expect(isToolAutoApproved(tool, hubServer)).toBe(true)
    })

    it('requires approval for invoke meta-tool', () => {
      const tool = makeTool({ serverId: 'hub', name: 'invoke' })
      const hubServer = makeServer({ id: 'hub' })
      expect(isToolAutoApproved(tool, hubServer)).toBe(false)
    })

    it('requires approval for exec meta-tool', () => {
      const tool = makeTool({ serverId: 'hub', name: 'exec' })
      const hubServer = makeServer({ id: 'hub' })
      expect(isToolAutoApproved(tool, hubServer)).toBe(false)
    })

    it('still allows built-in hub tools', () => {
      const tool = makeTool({ serverId: 'hub', name: 'invoke', isBuiltIn: true })
      const hubServer = makeServer({ id: 'hub' })
      expect(isToolAutoApproved(tool, hubServer)).toBe(true)
    })

    it('still allows agent allowed_tools for hub', () => {
      const tool = makeTool({ id: 'hub__invoke', serverId: 'hub', name: 'invoke' })
      const hubServer = makeServer({ id: 'hub' })
      expect(isToolAutoApproved(tool, hubServer, ['hub__invoke'])).toBe(true)
    })
  })
})
