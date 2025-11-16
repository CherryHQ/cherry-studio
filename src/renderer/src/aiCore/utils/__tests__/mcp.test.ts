/**
 * mcp.ts Unit Tests
 * Tests for MCP tools configuration and conversion utilities
 */

import type { MCPTool } from '@renderer/types'
import type { Tool } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { convertMcpToolsToAiSdkTools, setupToolsConfig } from '../mcp'

// Mock dependencies
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn()
    })
  }
}))

vi.mock('@renderer/utils/mcp-tools', () => ({
  getMcpServerByTool: vi.fn(() => ({ id: 'test-server', autoApprove: false })),
  isToolAutoApproved: vi.fn(() => false),
  callMCPTool: vi.fn(async () => ({
    content: [{ type: 'text', text: 'Tool executed successfully' }],
    isError: false
  }))
}))

vi.mock('@renderer/utils/userConfirmation', () => ({
  requestToolConfirmation: vi.fn(async () => true)
}))

describe('mcp utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('setupToolsConfig', () => {
    it('should return undefined when no MCP tools provided', () => {
      const result = setupToolsConfig()
      expect(result).toBeUndefined()
    })

    it('should return undefined when empty MCP tools array provided', () => {
      const result = setupToolsConfig([])
      expect(result).toBeUndefined()
    })

    it('should convert MCP tools to AI SDK tools format', () => {
      const mcpTools: MCPTool[] = [
        {
          id: 'test-tool-1',
          serverId: 'test-server',
          serverName: 'test-server',
          name: 'test-tool',
          description: 'A test tool',
          type: 'mcp',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' }
            }
          }
        }
      ]

      const result = setupToolsConfig(mcpTools)

      expect(result).not.toBeUndefined()
      expect(Object.keys(result!)).toEqual(['test-tool'])
      expect(result!['test-tool']).toHaveProperty('description')
      expect(result!['test-tool']).toHaveProperty('inputSchema')
      expect(result!['test-tool']).toHaveProperty('execute')
    })

    it('should handle multiple MCP tools', () => {
      const mcpTools: MCPTool[] = [
        {
          id: 'tool1-id',
          serverId: 'server1',
          serverName: 'server1',
          name: 'tool1',
          description: 'First tool',
          type: 'mcp',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          id: 'tool2-id',
          serverId: 'server2',
          serverName: 'server2',
          name: 'tool2',
          description: 'Second tool',
          type: 'mcp',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }
      ]

      const result = setupToolsConfig(mcpTools)

      expect(result).not.toBeUndefined()
      expect(Object.keys(result!)).toHaveLength(2)
      expect(Object.keys(result!)).toEqual(['tool1', 'tool2'])
    })
  })

  describe('convertMcpToolsToAiSdkTools', () => {
    it('should convert single MCP tool to AI SDK tool', () => {
      const mcpTools: MCPTool[] = [
        {
          id: 'get-weather-id',
          serverId: 'weather-server',
          serverName: 'weather-server',
          name: 'get-weather',
          description: 'Get weather information',
          type: 'mcp',
          inputSchema: {
            type: 'object',
            properties: {
              location: { type: 'string' }
            },
            required: ['location']
          }
        }
      ]

      const result = convertMcpToolsToAiSdkTools(mcpTools)

      expect(Object.keys(result)).toEqual(['get-weather'])

      const tool = result['get-weather'] as Tool
      expect(tool.description).toBe('Get weather information')
      expect(tool.inputSchema).toBeDefined()
      expect(typeof tool.execute).toBe('function')
    })

    it('should handle tool without description', () => {
      const mcpTools: MCPTool[] = [
        {
          id: 'no-desc-tool-id',
          serverId: 'test-server',
          serverName: 'test-server',
          name: 'no-desc-tool',
          type: 'mcp',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }
      ]

      const result = convertMcpToolsToAiSdkTools(mcpTools)

      expect(Object.keys(result)).toEqual(['no-desc-tool'])
      const tool = result['no-desc-tool'] as Tool
      expect(tool.description).toBe('Tool from test-server')
    })

    it('should convert empty tools array', () => {
      const result = convertMcpToolsToAiSdkTools([])
      expect(result).toEqual({})
    })

    it('should handle complex input schemas', () => {
      const mcpTools: MCPTool[] = [
        {
          id: 'complex-tool-id',
          serverId: 'server',
          serverName: 'server',
          name: 'complex-tool',
          description: 'Tool with complex schema',
          type: 'mcp',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              age: { type: 'number' },
              tags: {
                type: 'array',
                items: { type: 'string' }
              },
              metadata: {
                type: 'object',
                properties: {
                  key: { type: 'string' }
                }
              }
            },
            required: ['name']
          }
        }
      ]

      const result = convertMcpToolsToAiSdkTools(mcpTools)

      expect(Object.keys(result)).toEqual(['complex-tool'])
      const tool = result['complex-tool'] as Tool
      expect(tool.inputSchema).toBeDefined()
      expect(typeof tool.execute).toBe('function')
    })

    it('should preserve tool names with special characters', () => {
      const mcpTools: MCPTool[] = [
        {
          id: 'special-tool-id',
          serverId: 'server',
          serverName: 'server',
          name: 'tool_with-special.chars',
          description: 'Special chars tool',
          type: 'mcp',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }
      ]

      const result = convertMcpToolsToAiSdkTools(mcpTools)
      expect(Object.keys(result)).toEqual(['tool_with-special.chars'])
    })

    it('should handle multiple tools with different schemas', () => {
      const mcpTools: MCPTool[] = [
        {
          id: 'string-tool-id',
          serverId: 'server1',
          serverName: 'server1',
          name: 'string-tool',
          description: 'String tool',
          type: 'mcp',
          inputSchema: {
            type: 'object',
            properties: {
              input: { type: 'string' }
            }
          }
        },
        {
          id: 'number-tool-id',
          serverId: 'server2',
          serverName: 'server2',
          name: 'number-tool',
          description: 'Number tool',
          type: 'mcp',
          inputSchema: {
            type: 'object',
            properties: {
              count: { type: 'number' }
            }
          }
        },
        {
          id: 'boolean-tool-id',
          serverId: 'server3',
          serverName: 'server3',
          name: 'boolean-tool',
          description: 'Boolean tool',
          type: 'mcp',
          inputSchema: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' }
            }
          }
        }
      ]

      const result = convertMcpToolsToAiSdkTools(mcpTools)

      expect(Object.keys(result).sort()).toEqual(['boolean-tool', 'number-tool', 'string-tool'])
      expect(result['string-tool']).toBeDefined()
      expect(result['number-tool']).toBeDefined()
      expect(result['boolean-tool']).toBeDefined()
    })
  })

  describe('tool execution', () => {
    it('should execute tool with user confirmation', async () => {
      const { callMCPTool } = await import('@renderer/utils/mcp-tools')
      const { requestToolConfirmation } = await import('@renderer/utils/userConfirmation')

      vi.mocked(requestToolConfirmation).mockResolvedValue(true)
      vi.mocked(callMCPTool).mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }],
        isError: false
      })

      const mcpTools: MCPTool[] = [
        {
          id: 'test-exec-tool-id',
          serverId: 'test-server',
          serverName: 'test-server',
          name: 'test-exec-tool',
          description: 'Test execution tool',
          type: 'mcp',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }
      ]

      const tools = convertMcpToolsToAiSdkTools(mcpTools)
      const tool = tools['test-exec-tool'] as Tool
      const result = await tool.execute!({}, { messages: [], abortSignal: undefined, toolCallId: 'test-call-123' })

      expect(requestToolConfirmation).toHaveBeenCalled()
      expect(callMCPTool).toHaveBeenCalled()
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Success' }],
        isError: false
      })
    })

    it('should handle user cancellation', async () => {
      const { requestToolConfirmation } = await import('@renderer/utils/userConfirmation')
      const { callMCPTool } = await import('@renderer/utils/mcp-tools')

      vi.mocked(requestToolConfirmation).mockResolvedValue(false)

      const mcpTools: MCPTool[] = [
        {
          id: 'cancelled-tool-id',
          serverId: 'test-server',
          serverName: 'test-server',
          name: 'cancelled-tool',
          description: 'Tool to cancel',
          type: 'mcp',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }
      ]

      const tools = convertMcpToolsToAiSdkTools(mcpTools)
      const tool = tools['cancelled-tool'] as Tool
      const result = await tool.execute!({}, { messages: [], abortSignal: undefined, toolCallId: 'cancel-call-123' })

      expect(requestToolConfirmation).toHaveBeenCalled()
      expect(callMCPTool).not.toHaveBeenCalled()
      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: 'User declined to execute tool "cancelled-tool".'
          }
        ],
        isError: false
      })
    })

    it('should handle tool execution error', async () => {
      const { callMCPTool } = await import('@renderer/utils/mcp-tools')
      const { requestToolConfirmation } = await import('@renderer/utils/userConfirmation')

      vi.mocked(requestToolConfirmation).mockResolvedValue(true)
      vi.mocked(callMCPTool).mockResolvedValue({
        content: [{ type: 'text', text: 'Error occurred' }],
        isError: true
      })

      const mcpTools: MCPTool[] = [
        {
          id: 'error-tool-id',
          serverId: 'test-server',
          serverName: 'test-server',
          name: 'error-tool',
          description: 'Tool that errors',
          type: 'mcp',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }
      ]

      const tools = convertMcpToolsToAiSdkTools(mcpTools)
      const tool = tools['error-tool'] as Tool

      await expect(
        tool.execute!({}, { messages: [], abortSignal: undefined, toolCallId: 'error-call-123' })
      ).rejects.toEqual({
        content: [{ type: 'text', text: 'Error occurred' }],
        isError: true
      })
    })

    it('should auto-approve when enabled', async () => {
      const { callMCPTool, isToolAutoApproved } = await import('@renderer/utils/mcp-tools')
      const { requestToolConfirmation } = await import('@renderer/utils/userConfirmation')

      vi.mocked(isToolAutoApproved).mockReturnValue(true)
      vi.mocked(callMCPTool).mockResolvedValue({
        content: [{ type: 'text', text: 'Auto-approved success' }],
        isError: false
      })

      const mcpTools: MCPTool[] = [
        {
          id: 'auto-approve-tool-id',
          serverId: 'test-server',
          serverName: 'test-server',
          name: 'auto-approve-tool',
          description: 'Auto-approved tool',
          type: 'mcp',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }
      ]

      const tools = convertMcpToolsToAiSdkTools(mcpTools)
      const tool = tools['auto-approve-tool'] as Tool
      const result = await tool.execute!({}, { messages: [], abortSignal: undefined, toolCallId: 'auto-call-123' })

      expect(requestToolConfirmation).not.toHaveBeenCalled()
      expect(callMCPTool).toHaveBeenCalled()
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Auto-approved success' }],
        isError: false
      })
    })
  })
})
