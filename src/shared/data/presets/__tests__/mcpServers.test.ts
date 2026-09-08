import { PRESET_MCP_SERVERS } from '@shared/data/presets/mcpServers'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'
import { describe, expect, it } from 'vitest'

const preset = (name: string) => PRESET_MCP_SERVERS.find((server) => server.name === name)

describe('PRESET_MCP_SERVERS', () => {
  it('uses stable names without database identity or timestamps', () => {
    expect(PRESET_MCP_SERVERS).toHaveLength(13)
    expect(PRESET_MCP_SERVERS.every((server) => !('id' in server))).toBe(true)
    expect(PRESET_MCP_SERVERS.every((server) => !('createdAt' in server) && !('installedAt' in server))).toBe(true)
    expect(preset(BuiltinMcpServerNames.hub)).toBeUndefined()
  })

  it('models flomo and nowledge-mem as the HTTP endpoints they are', () => {
    expect(preset(BuiltinMcpServerNames.flomo)).toEqual(
      expect.objectContaining({ type: 'streamableHttp', baseUrl: 'https://flomoapp.com/mcp' })
    )
    expect(preset(BuiltinMcpServerNames.nowledgeMem)).toEqual(
      expect.objectContaining({ type: 'streamableHttp', baseUrl: 'http://127.0.0.1:14242/mcp' })
    )
  })

  it('models the online-package server as stdio instead of in-memory', () => {
    expect(preset(BuiltinMcpServerNames.mcpAutoInstall)).toEqual(
      expect.objectContaining({ type: 'stdio', command: 'npx' })
    )
  })

  it('models QVeris as a configurable hosted built-in server', () => {
    expect(preset(BuiltinMcpServerNames.qveris)).toEqual(
      expect.objectContaining({
        type: 'streamableHttp',
        baseUrl: 'https://mcp.qveris.ai/mcp',
        env: { QVERIS_API_KEY: '' },
        shouldConfig: true,
        isActive: false
      })
    )
  })

  it('models Cherry-hosted implementations as in-process', () => {
    for (const name of [
      BuiltinMcpServerNames.memory,
      BuiltinMcpServerNames.sequentialThinking,
      BuiltinMcpServerNames.browser
    ]) {
      expect(preset(name)?.type).toBe('inProcess')
    }
  })

  it('gives every external preset what it needs to connect', () => {
    for (const server of PRESET_MCP_SERVERS) {
      if (server.type === 'inProcess') continue
      if (server.type === 'stdio') {
        expect(server.command, server.name).toBeTruthy()
      } else {
        expect(server.baseUrl, server.name).toBeTruthy()
      }
    }
  })
})
