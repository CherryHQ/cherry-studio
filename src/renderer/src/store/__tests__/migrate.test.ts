import { BuiltinMCPServerNames, MCP_AUTO_INSTALL_ARGS } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import migrate from '../migrate'

describe('store migrations', () => {
  describe('migration 207: StepFun Anthropic-compatible host backfill', () => {
    it('backfills anthropicApiHost for existing StepFun providers', async () => {
      const state = {
        llm: {
          providers: [
            {
              id: 'stepfun',
              apiHost: 'https://api.stepfun.com'
            }
          ]
        },
        _persist: { version: 206, rehydrated: false }
      }

      const migrated: any = await migrate(state as any, 207)

      expect(migrated.llm.providers[0].anthropicApiHost).toBe('https://api.stepfun.com')
    })

    it('preserves existing StepFun anthropicApiHost customizations', async () => {
      const state = {
        llm: {
          providers: [
            {
              id: 'stepfun',
              apiHost: 'https://api.stepfun.com',
              anthropicApiHost: 'https://custom.example.com'
            }
          ]
        },
        _persist: { version: 206, rehydrated: false }
      }

      const migrated: any = await migrate(state as any, 207)

      expect(migrated.llm.providers[0].anthropicApiHost).toBe('https://custom.example.com')
    })
  })

  describe('migration 209: mcp-auto-install package repair', () => {
    it('replaces only the stale package name while preserving command and extra args', async () => {
      const state = {
        mcp: {
          servers: [
            {
              id: 'mcp-auto-install',
              name: BuiltinMCPServerNames.mcpAutoInstall,
              command: 'bun',
              args: ['x', BuiltinMCPServerNames.mcpAutoInstall, 'connect', '--json'],
              isActive: false
            }
          ]
        },
        _persist: { version: 208, rehydrated: false }
      }

      const migrated: any = await migrate(state as any, 209)

      expect(migrated.mcp.servers[0].command).toBe('bun')
      expect(migrated.mcp.servers[0].args).toEqual(['x', '@mcpmarket/mcp-auto-install', 'connect', '--json'])
    })

    it('preserves custom command and additional user flags', async () => {
      const state = {
        mcp: {
          servers: [
            {
              id: 'mcp-auto-install',
              name: BuiltinMCPServerNames.mcpAutoInstall,
              command: '/usr/local/bin/npx',
              args: [
                '--registry',
                'https://custom.registry.com',
                BuiltinMCPServerNames.mcpAutoInstall,
                'connect',
                '--json',
                '--verbose'
              ],
              isActive: false
            }
          ]
        },
        _persist: { version: 208, rehydrated: false }
      }

      const migrated: any = await migrate(state as any, 209)

      expect(migrated.mcp.servers[0].command).toBe('/usr/local/bin/npx')
      expect(migrated.mcp.servers[0].args).toEqual([
        '--registry',
        'https://custom.registry.com',
        '@mcpmarket/mcp-auto-install',
        'connect',
        '--json',
        '--verbose'
      ])
    })

    it('leaves correctly configured auto-install servers unchanged', async () => {
      const state = {
        mcp: {
          servers: [
            {
              id: 'mcp-auto-install',
              name: BuiltinMCPServerNames.mcpAutoInstall,
              command: 'npx',
              args: [...MCP_AUTO_INSTALL_ARGS],
              isActive: false
            }
          ]
        },
        _persist: { version: 208, rehydrated: false }
      }

      const migrated: any = await migrate(state as any, 209)

      expect(migrated.mcp.servers[0].command).toBe('npx')
      expect(migrated.mcp.servers[0].args).toEqual(MCP_AUTO_INSTALL_ARGS)
    })
  })
})
