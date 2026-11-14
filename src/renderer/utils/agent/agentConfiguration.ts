import { DEFAULT_PERMISSION_MODE } from '@shared/ai/agentPermissionMode'
import type { AgentConfiguration } from '@shared/data/api/schemas/agents'

export type AgentConfigurationState = AgentConfiguration & Record<string, unknown>

export const defaultConfiguration: AgentConfigurationState = {
  permission_mode: DEFAULT_PERMISSION_MODE,
  env_vars: {}
}
