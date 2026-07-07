import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { CreateAgentDto } from '@shared/data/api/schemas/agents'

import type { ResourceCreateWizardValues } from './types'

/**
 * Build the `POST /agents` body from wizard values, applying runtime-specific
 * defaults. Claude agents ship plan/small-model tiers and run full-auto by
 * default; pi agents skip the tiers and start in the gated `default`
 * permission mode since pi tool calls run at host privilege with no sandbox.
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

  const caps = AGENT_RUNTIME_CAPABILITIES[values.agentType]

  return {
    ...base,
    ...(caps.skills ? { skillIds: values.skillIds } : {}),
    ...(caps.modelTiers ? { planModel: values.modelId, smallModel: values.modelId } : {}),
    configuration: {
      ...base.configuration,
      permission_mode: caps.createDefaults.permissionMode
    }
  }
}
