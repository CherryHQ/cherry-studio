import { PRESET_MCP_SERVERS } from '@shared/data/presets/mcpServers'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'
import { describe, expect, it } from 'vitest'

const preset = (name: string) => PRESET_MCP_SERVERS.find((server) => server.name === name)

describe('PRESET_MCP_SERVERS', () => {
  it('models flomo and nowledge-mem as the HTTP endpoints they are', () => {
    for (const name of [BuiltinMcpServerNames.flomo, BuiltinMcpServerNames.nowledgeMem]) {
      expect(preset(name)).toEqual(
        expect.objectContaining({ type: 'streamableHttp', baseUrl: expect.stringMatching(/^https?:\/\//) })
      )
    }
  })

  it('models the online-package server as stdio instead of in-memory', () => {
    expect(preset(BuiltinMcpServerNames.mcpAutoInstall)).toEqual(
      expect.objectContaining({ type: 'stdio', command: 'npx' })
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
