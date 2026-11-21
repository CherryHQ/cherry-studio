import { application } from '@application'
import { agentService } from '@main/data/services/AgentService'
import { providerService } from '@main/data/services/ProviderService'
import { PRESETS_BINARY_TOOLS } from '@shared/data/presets/binaryTools'
import { CODE_CLI_TOOL_PRESETS } from '@shared/data/presets/codeCliTools'
import { parseUniqueModelId } from '@shared/data/types/model'
import { isExternalCliProvider } from '@shared/utils/provider'

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

    const presetNames = new Set(PRESETS_BINARY_TOOLS.map((tool) => tool.name))
    const codeCliNames = new Set(CODE_CLI_TOOL_PRESETS.map((tool) => tool.executable))
    signal.throwIfAborted()
    const dependencies = failed.filter(
      (tool) => presetNames.has(tool.name) || manager.hasCustomDependencyDefinition(tool.name)
    )
    const codeClis = failed.filter((tool) => codeCliNames.has(tool.name))
    const actionable = failed.length === dependencies.length + codeClis.length

    return {
      status: 'warn',
      attribution: actionable ? 'user-fixable' : 'app-bug',
      detail: { variant: 'failed', params: { count: failed.length } },
      actions: actionable
        ? ([
            ...(dependencies.length > 0 ? ([{ kind: 'navigate', target: '/settings/dependencies' }] as const) : []),
            ...(codeClis.length > 0 ? ([{ kind: 'navigate', target: '/app/code' }] as const) : [])
          ] as const)
        : [],
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
    const needsClaudeLogin = agentService.listAgents().agents.some((agent) => {
      if (agent.type !== 'claude-code' || !agent.model) return false
      const { providerId } = parseUniqueModelId(agent.model)
      return isExternalCliProvider(providerService.getByProviderId(providerId))
    })
    if (!needsClaudeLogin) return { status: 'pass' }
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
