import { PRESET_MCP_SERVERS } from '@shared/data/presets/mcpServers'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'
import { describe, expect, it } from 'vitest'

const preset = (name: string) => PRESET_MCP_SERVERS.find((server) => server.name === name)

describe('PRESET_MCP_SERVERS', () => {
  it('models flomo and nowledge-mem as the HTTP endpoints they are', () => {
    // The seeder writes these URLs onto installed rows, so the exact endpoint is the contract.
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

  it('gives every non in-memory preset what it needs to connect', () => {
    // The seeder copies these fields onto installed rows, so a preset missing them
    // would migrate a working server into an unconnectable one.
    for (const server of PRESET_MCP_SERVERS) {
      if (server.type === 'inMemory') continue
      if (server.type === 'stdio') {
        expect(server.command, server.name).toBeTruthy()
      } else {
        expect(server.baseUrl, server.name).toBeTruthy()
      }
    }
  })
})
