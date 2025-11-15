import { describe, expect, it } from 'vitest'

import { mcpToolsToOpenAIChatTools, mcpToolsToOpenAIResponseTools } from '../mcp-tools'
import type { MCPTool } from '@renderer/types'

describe('MCP Tools - HTTP MCP Compatibility Fix', () => {
  const mockMCPTool: MCPTool = {
    id: 'test_server-search_tool',
    name: 'search_tool',
    description: 'Search for information',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query'
        },
        limit: {
          type: 'number',
          description: 'Optional limit',
          minimum: 1
        }
      },
      required: ['query'] // Only query is required, limit is optional
    },
    serverId: 'test-server-id',
    serverName: 'test-server',
    type: 'mcp'
  }

  describe('mcpToolsToOpenAIResponseTools', () => {
    it('should preserve original schema without forcing all properties to be required', () => {
      const tools = mcpToolsToOpenAIResponseTools([mockMCPTool])
      
      expect(tools).toHaveLength(1)
      const tool = tools[0]
      
      // Should use the tool id
      expect(tool.name).toBe('test_server-search_tool')
      
      // Should preserve the original required array (only 'query')
      expect(tool.parameters.required).toEqual(['query'])
      
      // Should have both properties
      expect(tool.parameters.properties).toHaveProperty('query')
      expect(tool.parameters.properties).toHaveProperty('limit')
    })

    it('should not include strict: true', () => {
      const tools = mcpToolsToOpenAIResponseTools([mockMCPTool])
      
      expect(tools).toHaveLength(1)
      const tool = tools[0] as any
      
      // strict property should not be present
      expect(tool.strict).toBeUndefined()
    })
  })

  describe('mcpToolsToOpenAIChatTools', () => {
    it('should preserve original schema without forcing all properties to be required', () => {
      const tools = mcpToolsToOpenAIChatTools([mockMCPTool])
      
      expect(tools).toHaveLength(1)
      const tool = tools[0]
      
      // Should use the tool id
      expect(tool.function.name).toBe('test_server-search_tool')
      
      // Should include description
      expect(tool.function.description).toBe('Search for information')
      
      // Should preserve the original required array (only 'query')
      expect(tool.function.parameters.required).toEqual(['query'])
      
      // Should have both properties
      expect(tool.function.parameters.properties).toHaveProperty('query')
      expect(tool.function.parameters.properties).toHaveProperty('limit')
    })

    it('should not include strict: true in function parameters', () => {
      const tools = mcpToolsToOpenAIChatTools([mockMCPTool])
      
      expect(tools).toHaveLength(1)
      const tool = tools[0] as any
      
      // strict property should not be present
      expect(tool.function.strict).toBeUndefined()
    })
  })

  describe('HTTP MCP with complex nested schemas', () => {
    it('should handle nested objects with optional fields', () => {
      const complexTool: MCPTool = {
        id: 'http_server-complex_tool',
        name: 'complex_tool',
        description: 'Complex tool with nested schemas',
        inputSchema: {
          type: 'object',
          properties: {
            required_field: { type: 'string' },
            optional_object: {
              type: 'object',
              properties: {
                nested_required: { type: 'string' },
                nested_optional: { type: 'number' }
              },
              required: ['nested_required']
            }
          },
          required: ['required_field']
        },
        serverId: 'http-server-id',
        serverName: 'http-server',
        type: 'mcp'
      }

      const tools = mcpToolsToOpenAIChatTools([complexTool])
      const parameters = tools[0].function.parameters
      
      // Top level should only require 'required_field'
      expect(parameters.required).toEqual(['required_field'])
      
      // Nested object should only require 'nested_required'
      expect(parameters.properties.optional_object.required).toEqual(['nested_required'])
    })
  })
})
