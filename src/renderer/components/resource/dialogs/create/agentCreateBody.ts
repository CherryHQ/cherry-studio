import type { CreateAgentDto } from '@shared/data/api/schemas/agents'

import type { ResourceCreateWizardValues } from './types'

/**
 * Build the `POST /agents` body from wizard values, applying runtime-specific
 * defaults. Claude agents ship the soul preset + plan/small-model tiers and run
 * full-auto by default; pi agents have none of those (D8) and start in the
 * gated `default` permission mode since pi tool calls run at host privilege
 * with no sandbox.
 */
export function buildAgentCreateBody(values: ResourceCreateWizardValues): CreateAgentDto {
  const base: CreateAgentDto = {
    type: values.agentType,
    name: values.name,
    model: values.modelId,
    description: values.description,
    instructions: values.prompt,
    skillIds: values.skillIds,
    configuration: {
      avatar: values.avatar
    }
  }

  if (values.agentType === 'pi') {
    return {
      ...base,
      configuration: { ...base.configuration, permission_mode: 'default' }
    }
  }

  return {
    ...base,
    planModel: values.modelId,
    smallModel: values.modelId,
    configuration: { ...base.configuration, permission_mode: 'bypassPermissions', soul_enabled: true }
  }
}
