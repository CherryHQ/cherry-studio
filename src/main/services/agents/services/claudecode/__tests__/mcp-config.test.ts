import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { BuiltinMCPServerNames } from '@types'
import { describe, expect, it, vi } from 'vitest'

import { buildAgentMcpServerConfig } from '../mcp-config'

describe('buildAgentMcpServerConfig', () => {
  const apiConfig = {
    host: '127.0.0.1',
    port: 23333,
    apiKey: 'test-api-key'
  }

  it('binds selected built-in filesystem MCP to the agent workspace', async () => {
    const filesystemServer = {} as McpSdkServerConfigWithInstance['instance']
    const createFilesystemServer = vi.fn(() => filesystemServer)

    const result = await buildAgentMcpServerConfig({
      mcpIds: ['filesystem-id', 'other-id'],
      cwd: '/home/test/workspace',
      apiConfig,
      createFilesystemServer,
      getServerById: async (id) => {
        if (id === 'filesystem-id') {
          return { id, name: BuiltinMCPServerNames.filesystem }
        }
        return { id, name: 'other-server' }
      }
    })

    expect(createFilesystemServer).toHaveBeenCalledWith('/home/test/workspace')
    expect(result.strictMcpConfig).toBe(true)
    expect(result.mcpServers['filesystem-id']).toEqual({
      type: 'sdk',
      name: 'filesystem-id',
      instance: filesystemServer
    })
    expect(result.mcpServers['other-id']).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:23333/v1/mcps/other-id/mcp',
      headers: {
        Authorization: 'Bearer test-api-key'
      }
    })
  })

  it('keeps all non-filesystem MCP servers on the existing HTTP proxy path', async () => {
    const createFilesystemServer = vi.fn()

    const result = await buildAgentMcpServerConfig({
      mcpIds: ['remote-id'],
      cwd: '/home/test/workspace',
      apiConfig,
      createFilesystemServer,
      getServerById: async (id) => ({ id, name: 'remote-server' })
    })

    expect(createFilesystemServer).not.toHaveBeenCalled()
    expect(result).toEqual({
      strictMcpConfig: true,
      mcpServers: {
        'remote-id': {
          type: 'http',
          url: 'http://127.0.0.1:23333/v1/mcps/remote-id/mcp',
          headers: {
            Authorization: 'Bearer test-api-key'
          }
        }
      }
    })
  })
})
