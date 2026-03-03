import ClaudeAvatar from '@renderer/assets/images/models/claude.png'
import type { AgentBase, AgentType } from '@renderer/types'
import type { PermissionModeCard } from '@renderer/types/agent'

// base agent config. no default config for now.
const DEFAULT_AGENT_CONFIG: Omit<AgentBase, 'model'> = {
  accessible_paths: []
} as const

// no default config for now.
export const DEFAULT_CLAUDE_CODE_CONFIG: Omit<AgentBase, 'model'> = {
  ...DEFAULT_AGENT_CONFIG
} as const

export const getAgentTypeAvatar = (type: AgentType): string => {
  switch (type) {
    case 'claude-code':
      return ClaudeAvatar
    default:
      return ''
  }
}

export const permissionModeCards: PermissionModeCard[] = [
  {
    mode: 'default',
    // t('agent.settings.tooling.permissionMode.default.title')
    titleKey: 'agent.settings.tooling.permissionMode.default.title',
    titleFallback: 'Normal Mode',
    descriptionKey: 'agent.settings.tooling.permissionMode.default.description',
    descriptionFallback: 'Can read files freely. Asks before editing or running commands.'
  },
  {
    mode: 'plan',
    // t('agent.settings.tooling.permissionMode.plan.title')
    titleKey: 'agent.settings.tooling.permissionMode.plan.title',
    titleFallback: 'Plan Mode',
    descriptionKey: 'agent.settings.tooling.permissionMode.plan.description',
    descriptionFallback: 'Can only read files and make plans. Cannot edit files or run commands.'
  },
  {
    mode: 'acceptEdits',
    // t('agent.settings.tooling.permissionMode.acceptEdits.title')
    titleKey: 'agent.settings.tooling.permissionMode.acceptEdits.title',
    titleFallback: 'Auto-edit Mode',
    descriptionKey: 'agent.settings.tooling.permissionMode.acceptEdits.description',
    descriptionFallback: 'Can read and edit files freely. Asks before running commands.'
  },
  {
    mode: 'bypassPermissions',
    // t('agent.settings.tooling.permissionMode.bypassPermissions.title')
    titleKey: 'agent.settings.tooling.permissionMode.bypassPermissions.title',
    titleFallback: 'Full Auto Mode',
    descriptionKey: 'agent.settings.tooling.permissionMode.bypassPermissions.description',
    descriptionFallback: 'Can do everything without asking. Use with caution.',
    caution: true
  }
]
