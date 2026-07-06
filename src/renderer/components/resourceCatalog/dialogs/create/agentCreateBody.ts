import type { CreateAgentDto } from '@shared/data/api/schemas/agents'

import type { ResourceCreateWizardValues } from './types'

/**
 * Build the `POST /agents` body from wizard values, applying runtime-specific
 * defaults. Claude agents ship plan/small-model tiers and run full-auto by
 * default; pi agents have none of those (D8) and start in the
 * gated `default` permission mode since pi tool calls run at host privilege
 * with no sandbox. Pi runtime loads no skills (`noSkills: true`), so do not
 * persist skill IDs that would be ignored and hidden.
 */
export function buildAgentCreateBody(values: ResourceCreateWizardValues): CreateAgentDto {
  const base: CreateAgentDto = {
    type: values.agentType,
    name: values.name,
    model: values.modelId,
    description: values.description,
    instructions: values.prompt,
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
    skillIds: values.skillIds,
    planModel: values.modelId,
    smallModel: values.modelId,
    configuration: { ...base.configuration, permission_mode: 'bypassPermissions' }
  }
}
