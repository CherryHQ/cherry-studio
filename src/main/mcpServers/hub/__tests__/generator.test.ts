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

      const existingNames = new Set<string>()
      const callTool = async () => ({ success: true })

      const result = generateToolFunction(tool, existingNames, callTool)

      expect(result.functionName).toBe('githubServer_searchRepos')
      expect(result.jsCode).toContain('async function githubServer_searchRepos')
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

      const existingNames = new Set<string>(['server1_search'])
      const callTool = async () => ({})

      const result = generateToolFunction(tool, existingNames, callTool)

      expect(result.functionName).toBe('server1_search1')
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

      const existingNames = new Set<string>()
      const callTool = async () => ({})

      const result = generateToolFunction(tool, existingNames, callTool)

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
          functionName: 'server1_tool1',
          jsCode: 'async function server1_tool1() {}',
          fn: async () => ({}),
          signature: '{}',
          returns: 'unknown'
        },
        {
          serverId: 's2',
          serverName: 'server2',
          toolName: 'tool2',
          functionName: 'server2_tool2',
          jsCode: 'async function server2_tool2() {}',
          fn: async () => ({}),
          signature: '{}',
          returns: 'unknown'
        }
      ]

      const result = generateToolsCode(tools)

      expect(result).toContain('2 tool(s)')
      expect(result).toContain('async function server1_tool1')
      expect(result).toContain('async function server2_tool2')
    })

    it('returns message for empty tools', () => {
      const result = generateToolsCode([])
      expect(result).toBe('// No tools available')
    })
  })
})
