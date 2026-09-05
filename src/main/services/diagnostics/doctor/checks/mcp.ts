import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import type { LaunchResolutionCache } from '@main/ai/mcp/mcpLaunch'
import { resolveStdioLaunch } from '@main/ai/mcp/mcpStdioLaunch'
import { mcpTransportKind } from '@main/ai/mcp/mcpTransportKind'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { DoctorEvidenceItem } from '@shared/types/doctor'

import { defineDoctorCheck } from '../types'

const logger = loggerService.withContext('SystemDoctor:Mcp')

export const mcpServersConnected = defineDoctorCheck({
  id: 'mcp-servers-connected',
  async run() {
    const servers = mcpServerService.list({ isActive: true }).items
    if (!application.get('McpRuntimeService').isReady) throw new Error('MCP runtime is not ready')
    const cache = application.get('CacheService')
    const failed = servers.filter((server) => {
      const status = cache.getShared(`mcp.status.${server.id}`)
      return status?.state === 'error'
    })
    const pending = servers.filter((server) => {
      const status = cache.getShared(`mcp.status.${server.id}`)
      return status?.state !== 'connected' && status?.state !== 'error'
    })
    if (failed.length === 0) {
      if (pending.length) throw new Error('Some enabled MCP servers do not have a settled connection status')
      return { status: 'pass' }
    }

    return {
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'server_errors', params: { count: failed.length } },
      actions: failed.map((server) => ({ kind: 'fix' as const, fixId: 'restart' as const, target: server.id })),
      evidence: [
        { key: 'unsettledCount', value: pending.length, dataClass: 'public' },
        { key: 'serverCount', value: failed.length, dataClass: 'public' },
        { key: 'serverIds', value: failed.map(({ id }) => id).join(', '), dataClass: 'local_only' },
        { key: 'serverNames', value: failed.map(({ name }) => name).join(', '), dataClass: 'local_only' },
        {
          key: 'lastErrors',
          value: failed.map((server) => cache.getShared(`mcp.status.${server.id}`)?.lastError ?? '').join('\n'),
          dataClass: 'consent_required'
        }
      ]
    }
  },
  fixes: {
    async restart({ target }) {
      const server = mcpServerService.getById(target)
      if (!server.isActive) return { status: 'failed', message: 'MCP server is disabled' }
      const runtime = application.get('McpRuntimeService')
      if (!runtime.isReady) throw new Error('MCP runtime is not ready')
      await runtime.restartServer(target)
      return { status: 'fixed' }
    }
  }
})

export const mcpLaunchCommands = defineDoctorCheck({
  id: 'mcp-launch-commands',
  timeoutMs: 20_000,
  async run({ signal }) {
    const servers = mcpServerService
      .list({ isActive: true })
      .items.filter((server) => mcpTransportKind(server) === 'stdio')
    const failed: McpServer[] = []
    const unresolved: { serverId: string; command: string }[] = []
    const errors: DoctorEvidenceItem[] = []
    const resolutionCache: LaunchResolutionCache = new Map()
    for (const server of servers) {
      signal.throwIfAborted()
      try {
        const { launch } = await resolveStdioLaunch({
          server,
          args: [...(server.args ?? [])],
          logger,
          signal,
          resolutionCache
        })
        if (launch.resolution === 'unresolved') {
          failed.push(server)
          unresolved.push({ serverId: server.id, command: launch.command })
        }
      } catch (error) {
        signal.throwIfAborted()
        errors.push({
          key: 'queryError',
          value: JSON.stringify({
            serverId: server.id,
            message: error instanceof Error ? error.message : String(error)
          }),
          dataClass: 'consent_required'
        })
      }
    }
    if (failed.length === 0 && errors.length === 0) return { status: 'pass' }

    return {
      status: errors.length ? 'warn' : 'fail',
      attribution: errors.length ? 'transient' : 'user-fixable',
      detail: {
        variant: errors.length ? 'query_failed' : 'unresolved',
        params: { count: errors.length || failed.length }
      },
      actions: [{ kind: 'navigate', target: '/settings/mcp' }],
      devMessage: `${failed.length} enabled stdio MCP command(s) could not be resolved`,
      evidence: [
        ...errors,
        { key: 'unresolvedCommands', value: JSON.stringify(unresolved), dataClass: 'local_only' },
        { key: 'serverCount', value: failed.length, dataClass: 'public' },
        { key: 'serverIds', value: failed.map(({ id }) => id).join(', '), dataClass: 'local_only' },
        { key: 'serverNames', value: failed.map(({ name }) => name).join(', '), dataClass: 'local_only' }
      ]
    }
  },
  fixes: {}
})
