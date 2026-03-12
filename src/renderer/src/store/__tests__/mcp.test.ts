import { BuiltinMCPServerNames } from '@renderer/types'
import { createMigrate } from 'redux-persist'
import { describe, expect, it } from 'vitest'

import { builtinMCPServers } from '../mcp'

describe('MCP filesystem defaults', () => {
  it('disables auto-approve for sensitive filesystem tools by default', () => {
    const filesystemServer = builtinMCPServers.find((server) => server.name === BuiltinMCPServerNames.filesystem)

    expect(filesystemServer?.disabledAutoApproveTools).toEqual(['write', 'edit', 'delete'])
  })

  describe('migration 201: filesystem approval backfill', () => {
    // Isolated migration function matching the logic in migrate.ts version 201
    const migrate201 = (state: any) => {
      const filesystemServer = state.mcp?.servers?.find((s: any) => s.name === '@cherry/filesystem')
      if (filesystemServer && filesystemServer.disabledAutoApproveTools === undefined) {
        filesystemServer.disabledAutoApproveTools = ['write', 'edit', 'delete']
      }
      return state
    }

    const migrate = createMigrate({ '201': migrate201 as any })

    it('backfills manual approval defaults for existing filesystem servers', async () => {
      const state = {
        mcp: {
          servers: [
            {
              id: 'filesystem-server',
              name: '@cherry/filesystem',
              type: 'inMemory',
              args: ['/tmp/workspace'],
              isActive: true
            }
          ]
        },
        _persist: { version: 200, rehydrated: false }
      }

      const migrated: any = await migrate(state, 201)

      expect(migrated.mcp.servers[0].disabledAutoApproveTools).toEqual(['write', 'edit', 'delete'])
    })

    it('preserves existing disabledAutoApproveTools', async () => {
      const state = {
        mcp: {
          servers: [
            {
              id: 'filesystem-server',
              name: '@cherry/filesystem',
              type: 'inMemory',
              args: ['/tmp/workspace'],
              isActive: true,
              disabledAutoApproveTools: ['write']
            }
          ]
        },
        _persist: { version: 200, rehydrated: false }
      }

      const migrated: any = await migrate(state, 201)

      expect(migrated.mcp.servers[0].disabledAutoApproveTools).toEqual(['write'])
    })
  })
})
