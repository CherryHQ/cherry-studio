/**
 * mcp.ts Unit Tests
 * Tests for MCP tools configuration and conversion utilities
 */

import type { MCPTool } from '@renderer/types'
import type { Tool } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { convertMcpToolsToAiSdkTools, hasMultimodalContent, mcpResultToTextSummary, setupToolsConfig } from '../mcp'

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
      // Tools are now keyed by id (which includes serverId suffix) for uniqueness
      expect(Object.keys(result!)).toEqual(['test-tool-1'])
      expect(result!['test-tool-1']).toHaveProperty('description')
      expect(result!['test-tool-1']).toHaveProperty('inputSchema')
      expect(result!['test-tool-1']).toHaveProperty('execute')
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
      // Tools are keyed by id for uniqueness
      expect(Object.keys(result!)).toEqual(['tool1-id', 'tool2-id'])
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

      // Tools are keyed by id for uniqueness when multiple server instances exist
      expect(Object.keys(result)).toEqual(['get-weather-id'])

      const tool = result['get-weather-id'] as Tool
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

      expect(Object.keys(result)).toEqual(['no-desc-tool-id'])
      const tool = result['no-desc-tool-id'] as Tool
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

      expect(Object.keys(result)).toEqual(['complex-tool-id'])
      const tool = result['complex-tool-id'] as Tool
      expect(tool.inputSchema).toBeDefined()
      expect(typeof tool.execute).toBe('function')
    })

    it('should preserve tool id with special characters', () => {
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
      // Tools are keyed by id for uniqueness
      expect(Object.keys(result)).toEqual(['special-tool-id'])
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

      // Tools are keyed by id for uniqueness
      expect(Object.keys(result).sort()).toEqual(['boolean-tool-id', 'number-tool-id', 'string-tool-id'])
      expect(result['string-tool-id']).toBeDefined()
      expect(result['number-tool-id']).toBeDefined()
      expect(result['boolean-tool-id']).toBeDefined()
    })
  })

  describe('hasMultimodalContent', () => {
    it('should return false for pure text content', () => {
      expect(hasMultimodalContent({ content: [{ type: 'text', text: 'hello' }] })).toBe(false)
    })

    it('should return true for image content', () => {
      expect(hasMultimodalContent({ content: [{ type: 'image', data: 'base64...', mimeType: 'image/png' }] })).toBe(
        true
      )
    })

    it('should return true for audio content', () => {
      expect(hasMultimodalContent({ content: [{ type: 'audio', data: 'base64...', mimeType: 'audio/mp3' }] })).toBe(
        true
      )
    })

    it('should return true for resource with blob', () => {
      expect(
        hasMultimodalContent({
          content: [{ type: 'resource', resource: { blob: 'base64...', mimeType: 'image/png', uri: 'file://a.png' } }]
        })
      ).toBe(true)
    })

    it('should return false for resource without blob', () => {
      expect(
        hasMultimodalContent({
          content: [{ type: 'resource', resource: { text: 'plain text', uri: 'file://a.txt' } }]
        })
      ).toBe(false)
    })

    it('should return true for mixed content with at least one multimodal item', () => {
      expect(
        hasMultimodalContent({
          content: [
            { type: 'text', text: 'hello' },
            { type: 'image', data: 'base64...', mimeType: 'image/png' }
          ]
        })
      ).toBe(true)
    })

    it('should return false for empty content array', () => {
      expect(hasMultimodalContent({ content: [] })).toBe(false)
    })

    it('should return false for null/undefined result', () => {
      expect(hasMultimodalContent(null as any)).toBe(false)
      expect(hasMultimodalContent(undefined as any)).toBe(false)
    })

    it('should return false when content is not an array', () => {
      expect(hasMultimodalContent({ content: 'not-array' } as any)).toBe(false)
    })
  })

  describe('mcpResultToTextSummary', () => {
    it('should extract text from text content', () => {
      expect(mcpResultToTextSummary({ content: [{ type: 'text', text: 'hello world' }] })).toBe('hello world')
    })

    it('should replace image with placeholder', () => {
      expect(mcpResultToTextSummary({ content: [{ type: 'image', data: 'base64...', mimeType: 'image/jpeg' }] })).toBe(
        '[Image: image/jpeg, delivered to user]'
      )
    })

    it('should use default mimeType for image without mimeType', () => {
      expect(mcpResultToTextSummary({ content: [{ type: 'image', data: 'base64...' }] })).toBe(
        '[Image: image/png, delivered to user]'
      )
    })

    it('should replace audio with placeholder', () => {
      expect(mcpResultToTextSummary({ content: [{ type: 'audio', data: 'base64...', mimeType: 'audio/wav' }] })).toBe(
        '[Audio: audio/wav, delivered to user]'
      )
    })

    it('should use default mimeType for audio without mimeType', () => {
      expect(mcpResultToTextSummary({ content: [{ type: 'audio', data: 'base64...' }] })).toBe(
        '[Audio: audio/mp3, delivered to user]'
      )
    })

    it('should replace resource with blob with placeholder', () => {
      expect(
        mcpResultToTextSummary({
          content: [
            { type: 'resource', resource: { blob: 'base64...', mimeType: 'application/pdf', uri: 'file://doc.pdf' } }
          ]
        })
      ).toBe('[Resource: application/pdf, uri=file://doc.pdf, delivered to user]')
    })

    it('should use resource text when no blob', () => {
      expect(
        mcpResultToTextSummary({
          content: [{ type: 'resource', resource: { text: 'resource content', uri: 'file://a.txt' } }]
        })
      ).toBe('resource content')
    })

    it('should JSON.stringify unknown content types', () => {
      const item = { type: 'unknown' as any, foo: 'bar' }
      expect(mcpResultToTextSummary({ content: [item] })).toBe(JSON.stringify(item))
    })

    it('should join multiple content parts with newline', () => {
      const result = mcpResultToTextSummary({
        content: [
          { type: 'text', text: 'Description' },
          { type: 'image', data: 'base64...', mimeType: 'image/png' }
        ]
      })
      expect(result).toBe('Description\n[Image: image/png, delivered to user]')
    })

    it('should JSON.stringify result when content is missing', () => {
      expect(mcpResultToTextSummary(null as any)).toBe('null')
      expect(mcpResultToTextSummary({} as any)).toBe('{}')
    })

    it('should handle empty text gracefully', () => {
      expect(mcpResultToTextSummary({ content: [{ type: 'text' }] })).toBe('')
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
      const tool = tools['test-exec-tool-id'] as Tool
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
      const tool = tools['cancelled-tool-id'] as Tool
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
      const tool = tools['error-tool-id'] as Tool

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
      const tool = tools['auto-approve-tool-id'] as Tool
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
