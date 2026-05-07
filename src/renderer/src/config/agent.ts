import type { AgentBase, AgentConfiguration } from '@renderer/types'
import type { PermissionModeCard } from '@renderer/types/agent'

// base agent config. no default config for now.
const DEFAULT_AGENT_CONFIG: Omit<AgentBase, 'model'> = {
  accessible_paths: []
} as const

// no default config for now.
export const DEFAULT_CLAUDE_CODE_CONFIG: Omit<AgentBase, 'model'> = {
  ...DEFAULT_AGENT_CONFIG
} as const

export const DEFAULT_CHERRY_CLAW_CONFIG: Omit<AgentBase, 'model'> & { configuration: AgentConfiguration } = {
  ...DEFAULT_AGENT_CONFIG,
  configuration: {
    permission_mode: 'bypassPermissions',
    max_turns: 100,
    env_vars: {},
    soul_enabled: true,
    scheduler_enabled: false,
    scheduler_type: 'interval',
    heartbeat_enabled: true,
    heartbeat_interval: 30
  }
} as const

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
