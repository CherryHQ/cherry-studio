import type { PermissionMode } from '@renderer/types'

export type PermissionModeCard = {
  mode: PermissionMode
  titleKey: string
  titleFallback: string
  descriptionKey: string
  descriptionFallback: string
  behaviorKey: string
  behaviorFallback: string
  caution?: boolean
  unsupported?: boolean
}

export const permissionModeCards: PermissionModeCard[] = [
  {
    mode: 'default',
    titleKey: 'agent.settings.tooling.permissionMode.default.title',
    titleFallback: 'Default (ask before continuing)',
    descriptionKey: 'agent.settings.tooling.permissionMode.default.description',
    descriptionFallback: 'Read-only tools are pre-approved; everything else still needs permission.',
    behaviorKey: 'agent.settings.tooling.permissionMode.default.behavior',
    behaviorFallback: 'Read-only tools are pre-approved automatically.'
  },
  {
    mode: 'plan',
    titleKey: 'agent.settings.tooling.permissionMode.plan.title',
    titleFallback: 'Planning mode',
    descriptionKey: 'agent.settings.tooling.permissionMode.plan.description',
    descriptionFallback: 'Shares the default read-only tool set but presents a plan before execution.',
    behaviorKey: 'agent.settings.tooling.permissionMode.plan.behavior',
    behaviorFallback: 'Read-only defaults are pre-approved while execution remains disabled.'
  },
  {
    mode: 'acceptEdits',
    titleKey: 'agent.settings.tooling.permissionMode.acceptEdits.title',
    titleFallback: 'Auto-accept file edits',
    descriptionKey: 'agent.settings.tooling.permissionMode.acceptEdits.description',
    descriptionFallback: 'File edits and filesystem operations are automatically approved.',
    behaviorKey: 'agent.settings.tooling.permissionMode.acceptEdits.behavior',
    behaviorFallback: 'Pre-approves trusted filesystem tools so edits run immediately.'
  },
  {
    mode: 'bypassPermissions',
    titleKey: 'agent.settings.tooling.permissionMode.bypassPermissions.title',
    titleFallback: 'Bypass permission checks',
    descriptionKey: 'agent.settings.tooling.permissionMode.bypassPermissions.description',
    descriptionFallback: 'All permission prompts are skipped — use with caution.',
    behaviorKey: 'agent.settings.tooling.permissionMode.bypassPermissions.behavior',
    behaviorFallback: 'Every tool is pre-approved automatically.',
    caution: true
  }
]
