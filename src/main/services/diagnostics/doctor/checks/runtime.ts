import { application } from '@application'
import { agentService } from '@main/data/services/AgentService'

import { defineDoctorCheck } from '../types'

export const managedTools = defineDoctorCheck({
  id: 'runtime-managed-tools',
  async run() {
    const inventory = await application.get('BinaryManager').getToolInventory()
    const failed = inventory.filter((tool) => tool.status === 'failed')
    if (failed.length === 0) return { status: 'pass' }

    return {
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'failed', params: { count: failed.length } },
      actions: [{ kind: 'navigate', target: '/settings/dependencies' }],
      devMessage: `Managed tools with a broken installation or failed operation: ${failed.map((tool) => tool.name).join(', ')}`,
      evidence: [{ key: 'tools', value: failed.map((tool) => tool.name).join(', '), dataClass: 'public' }]
    }
  },
  fixes: {}
})

export const claudeLogin = defineDoctorCheck({
  id: 'runtime-claude-login',
  async run() {
    const hasClaudeAgent = agentService.listAgents().agents.some((agent) => agent.type === 'claude-code')
    if (!hasClaudeAgent || (await application.get('CodeCliService').checkClaudeLogin())) return { status: 'pass' }

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
