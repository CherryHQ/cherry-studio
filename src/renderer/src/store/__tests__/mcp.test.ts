import { BuiltinMCPServerNames, type MCPServer } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

import { builtinMCPServers, initializeMCPServers, updateMCPServer } from '../mcp'

describe('MCP filesystem defaults', () => {
  it('disables auto-approve for sensitive filesystem tools by default', () => {
    const filesystemServer = builtinMCPServers.find((server) => server.name === BuiltinMCPServerNames.filesystem)

    expect(filesystemServer?.disabledAutoApproveTools).toEqual(['write', 'edit', 'delete'])
  })

  it('backfills manual approval defaults for existing filesystem servers', () => {
    const dispatch = vi.fn()
    const existingFilesystemServer: MCPServer = {
      id: 'filesystem-server',
      name: BuiltinMCPServerNames.filesystem,
      type: 'inMemory',
      args: ['/tmp/workspace'],
      isActive: true
    }

    initializeMCPServers([existingFilesystemServer], dispatch)

    expect(dispatch).toHaveBeenCalledWith(
      updateMCPServer({
        ...existingFilesystemServer,
        disabledAutoApproveTools: ['write', 'edit', 'delete']
      })
    )
  })
})
