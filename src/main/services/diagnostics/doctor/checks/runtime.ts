import { application } from '@application'
import { agentService } from '@main/data/services/AgentService'

import { defineDoctorCheck } from '../types'

export const managedTools = defineDoctorCheck({
  id: 'runtime-managed-tools',
  timeoutMs: 20_000,
  async run({ signal }) {
    const manager = application.get('BinaryManager')
    if (!manager.isReady) throw new Error('Binary manager is not ready')
    const inventory = await manager.getToolInventory(signal)
    if (inventory.some((tool) => tool.status === 'unknown')) throw new Error('Managed tool inventory is incomplete')
    if (inventory.some((tool) => tool.status === 'installing' || tool.status === 'removing'))
      throw new Error('Managed tool operations are still running')
    const failed = inventory.filter((tool) => tool.status === 'failed')
    if (failed.length === 0) return { status: 'pass' }

    return {
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'failed', params: { count: failed.length } },
      actions: [{ kind: 'navigate', target: '/settings/dependencies' }],
      devMessage: 'Managed tools have a broken installation or failed operation',
      evidence: [{ key: 'tools', value: failed.map((tool) => tool.name).join(', '), dataClass: 'local_only' }]
    }
  },
  fixes: {}
})

export const claudeLogin = defineDoctorCheck({
  id: 'runtime-claude-login',
  timeoutMs: 20_000,
  async run({ signal }) {
    const hasClaudeAgent = agentService.listAgents().agents.some((agent) => agent.type === 'claude-code')
    if (!hasClaudeAgent) return { status: 'pass' }
    const cli = application.get('CodeCliService')
    if (!cli.isReady) throw new Error('Code CLI service is not ready')
    if (await cli.checkClaudeLogin(signal)) return { status: 'pass' }

    return {
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'not_logged_in' },
      actions: [{ kind: 'navigate', target: '/settings/provider?id=claude-code' }],
      devMessage: 'A Claude Code agent is configured but the Claude CLI is not logged in'
    }
  },
  fixes: {}
})
