import { describe, expect, it } from 'vitest'

import { generateToolFunction, generateToolsCode } from '../generator'
import type { GeneratedTool } from '../types'

describe('generator', () => {
  describe('generateToolFunction', () => {
    it('generates a simple tool function', () => {
      const tool = {
        id: 'test-id',
        name: 'search_repos',
        description: 'Search for GitHub repositories',
        serverId: 'github',
        serverName: 'github-server',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results' }
          },
          required: ['query']
        },
        type: 'mcp' as const
      }

      const server = {
        id: 'github',
        name: 'github-server',
        isActive: true
      }

      const existingNames = new Set<string>()
      const callTool = async () => ({ success: true })

      const result = generateToolFunction(tool, server as any, existingNames, callTool)

      expect(result.toolId).toBe('github__search_repos')
      expect(result.functionName).toBe('searchRepos')
      expect(result.jsCode).toContain('async function searchRepos')
      expect(result.jsCode).toContain('Search for GitHub repositories')
      expect(result.jsCode).toContain('__callTool')
    })

    it('handles unique function names', () => {
      const tool = {
        id: 'test-id',
        name: 'search',
        serverId: 'server1',
        serverName: 'server1',
        inputSchema: { type: 'object' as const, properties: {} },
        type: 'mcp' as const
      }

      const server = { id: 'server1', name: 'server1', isActive: true }
      const existingNames = new Set<string>(['search'])
      const callTool = async () => ({})

      const result = generateToolFunction(tool, server as any, existingNames, callTool)

      expect(result.functionName).toBe('search1')
    })

    it('handles enum types in schema', () => {
      const tool = {
        id: 'test-id',
        name: 'launch_browser',
        serverId: 'browser',
        serverName: 'browser',
        inputSchema: {
          type: 'object' as const,
          properties: {
            browser: {
              type: 'string',
              enum: ['chromium', 'firefox', 'webkit']
            }
          }
        },
        type: 'mcp' as const
      }

      const server = { id: 'browser', name: 'browser', isActive: true }
      const existingNames = new Set<string>()
      const callTool = async () => ({})

      const result = generateToolFunction(tool, server as any, existingNames, callTool)

      expect(result.jsCode).toContain('"chromium" | "firefox" | "webkit"')
    })
  })

  describe('generateToolsCode', () => {
    it('generates code for multiple tools', () => {
      const tools: GeneratedTool[] = [
        {
          serverId: 's1',
          serverName: 'server1',
          toolName: 'tool1',
          toolId: 's1__tool1',
          functionName: 'tool1',
          jsCode: 'async function tool1() {}',
          fn: async () => ({}),
          signature: '{}',
          returns: 'unknown'
        },
        {
          serverId: 's2',
          serverName: 'server2',
          toolName: 'tool2',
          toolId: 's2__tool2',
          functionName: 'tool2',
          jsCode: 'async function tool2() {}',
          fn: async () => ({}),
          signature: '{}',
          returns: 'unknown'
        }
      ]

      const result = generateToolsCode(tools)

      expect(result).toContain('Found 2 tool(s)')
      expect(result).toContain('async function tool1')
      expect(result).toContain('async function tool2')
    })

    it('returns message for empty tools', () => {
      const result = generateToolsCode([])
      expect(result).toBe('// No tools available')
    })
  })
})
