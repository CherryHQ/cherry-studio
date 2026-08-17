import { BuiltinMcpServerNames, isInMemoryBuiltinMcpServer } from '@shared/utils/mcp'
import { describe, expect, it } from 'vitest'

import { builtinMcpServers } from '../builtinMcpServers'

describe('builtinMcpServers', () => {
  it('models the online-package server as stdio instead of in-memory', () => {
    const server = builtinMcpServers.find(({ name }) => name === BuiltinMcpServerNames.mcpAutoInstall)

    expect(server).toEqual(expect.objectContaining({ type: 'stdio', command: 'npx' }))
    expect(server && isInMemoryBuiltinMcpServer(server)).toBe(false)
  })

  it('models QVeris as a configurable hosted built-in server', () => {
    const server = builtinMcpServers.find(({ name }) => name === BuiltinMcpServerNames.qveris)

    expect(server).toEqual(
      expect.objectContaining({
        type: 'inMemory',
        env: { QVERIS_API_KEY: '' },
        shouldConfig: true,
        isActive: false
      })
    )
    expect(server && isInMemoryBuiltinMcpServer(server)).toBe(true)
    expect(server).not.toHaveProperty('disabledAutoApproveTools')
  })
})
