import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { resolveStdioLaunch } from '@main/ai/mcp/mcpStdioLaunch'
import type { McpServer } from '@shared/data/types/mcpServer'

import { defineDoctorCheck } from '../types'

const logger = loggerService.withContext('SystemDoctor:Mcp')

function isStdio(server: McpServer): boolean {
  return server.type === 'stdio' || (server.type === undefined && Boolean(server.command) && !server.baseUrl)
}

export const mcpServersConnected = defineDoctorCheck({
  id: 'mcp-servers-connected',
  async run() {
    const servers = mcpServerService.list({ isActive: true }).items
    const cache = application.get('CacheService')
    const failed = servers.filter((server) => {
      const status = cache.getShared(`mcp.status.${server.id}`)
      return status?.state === 'error'
    })
    if (failed.length === 0) return { status: 'pass' }

    return {
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'server_errors', params: { count: failed.length } },
      actions: failed.map((server) => ({ kind: 'fix' as const, fixId: 'restart' as const, target: server.id })),
      evidence: [
        { key: 'serverCount', value: failed.length, dataClass: 'public' },
        { key: 'serverIds', value: failed.map(({ id }) => id).join(', '), dataClass: 'local_only' },
        { key: 'serverNames', value: failed.map(({ name }) => name).join(', '), dataClass: 'local_only' }
      ]
    }
  },
  fixes: {
    async restart({ target }) {
      if (!target) return { status: 'failed', message: 'MCP server target is missing' }
      const server = mcpServerService.getById(target)
      if (!server.isActive) return { status: 'failed', message: 'MCP server is disabled' }
      await application.get('McpRuntimeService').restartServer(target)
      return { status: 'fixed' }
    }
  }
})

export const mcpLaunchCommands = defineDoctorCheck({
  id: 'mcp-launch-commands',
  async run({ signal }) {
    const servers = mcpServerService.list({ isActive: true }).items.filter(isStdio)
    const failed: McpServer[] = []
    for (const server of servers) {
      signal.throwIfAborted()
      try {
        await resolveStdioLaunch({ server, args: [...(server.args ?? [])], logger, requireResolvable: true })
      } catch {
        failed.push(server)
      }
    }
    if (failed.length === 0) return { status: 'pass' }

    return {
      status: 'fail',
      attribution: 'user-fixable',
      detail: { variant: 'unresolved', params: { count: failed.length } },
      actions: [{ kind: 'navigate', target: '/settings/mcp' }],
      devMessage: `${failed.length} enabled stdio MCP command(s) could not be resolved`,
      evidence: [
        { key: 'serverCount', value: failed.length, dataClass: 'public' },
        { key: 'serverIds', value: failed.map(({ id }) => id).join(', '), dataClass: 'local_only' },
        { key: 'serverNames', value: failed.map(({ name }) => name).join(', '), dataClass: 'local_only' }
      ]
    }
  },
  fixes: {}
})
