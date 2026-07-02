import type { AgentConfiguration } from '@shared/data/api/schemas/agents'

import { DEFAULT_PERMISSION_MODE } from './permissionMode'

export type AgentConfigurationState = AgentConfiguration & Record<string, unknown>

export const defaultConfiguration: AgentConfigurationState = {
  permission_mode: DEFAULT_PERMISSION_MODE,
  env_vars: {}
}

export const isSoulModeEnabled = (configuration: AgentConfiguration | undefined | null): boolean =>
  configuration?.soul_enabled === true
